/*
 * Copyright (C) 2018 Red Hat, Inc.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { Event } from '@theia/core/lib/common/event';
import { LazyPromise } from './lazy-promise';

export interface MessageConnection {
    send(msg: {}): void;
    onMessage: Event<{}>;
}

export interface RPCProtocol {
    /**
     * Returns a proxy to an object addressable/named in the extension process or in the main process.
     */
    getProxy<T>(proxyId: ProxyIdentifier<T>): T;

}

export class ProxyIdentifier<T> {
    public readonly id: string;
    constructor(public readonly isMain: boolean, id: string | T) {
        // TODO this is nasty, rewrite this
        this.id = id.toString();
    }
}

export function createMainProxyIdentifier<T>(identifier: string): ProxyIdentifier<T> {
    return new ProxyIdentifier(true, 'm' + identifier);
}

export function createExtensionProxyIdentifier<T>(identifier: string): ProxyIdentifier<T> {
    return new ProxyIdentifier(false, 'e' + identifier);
}

export class RPCProtocolImpl implements RPCProtocol {
    private isDisposed: boolean;
    private readonly locals: { [id: string]: any; };
    private readonly proxies: { [id: string]: any; };
    private lastMessageId: number;
    private readonly invokedHandlers: { [req: string]: Promise<any>; };
    private readonly pendingRPCReplies: { [msgId: string]: LazyPromise; };
    private readonly multiplexor: RPCMultiplexer;

    constructor(connection: MessageConnection) {
        this.isDisposed = false;
        this.locals = Object.create(null);
        this.proxies = Object.create(null);
        this.lastMessageId = 0;
        this.invokedHandlers = Object.create(null);
        this.pendingRPCReplies = {};
        this.multiplexor = new RPCMultiplexer(connection, (msg) => this.receiveOneMessage(msg));
    }
    getProxy<T>(proxyId: ProxyIdentifier<T>): T {
        if (!this.proxies[proxyId.id]) {
            this.proxies[proxyId.id] = this.createProxy(proxyId.id);
        }
        return this.proxies[proxyId.id];
    }

    private createProxy<T>(proxyId: string): T {
        const handler = {
            get: (target: any, name: string) => {
                if (!target[name] && name.charCodeAt(0) === 36 /* CharCode.DollarSign */) {
                    target[name] = (...myArgs: any[]) =>
                        this.remoteCall(proxyId, name, myArgs);
                }
                return target[name];
            }
        };
        return new Proxy(Object.create(null), handler);
    }

    private remoteCall(proxyId: string, methodName: string, args: any[]): Promise<any> {
        if (this.isDisposed) {
            return Promise.reject(canceled());
        }

        const callId = String(++this.lastMessageId);
        const result = new LazyPromise();

        this.pendingRPCReplies[callId] = result;
        this.multiplexor.send(MessageFactory.request(callId, proxyId, methodName, args));
        return result;
    }

    private receiveOneMessage(rawmsg: string): void {
        if (this.isDisposed) {
            return;
        }

        const msg = <RPCMessage>JSON.parse(rawmsg);

        switch (msg.type) {
            case MessageType.Request:
                this.receiveRequest(msg);
                break;
            case MessageType.Reply:
                this.receiveReply(msg);
                break;
            case MessageType.ReplyErr:
                this.receiveReplyErr(msg);
                break;
        }
    }

    private receiveRequest(msg: RequestMessage): void {
        const callId = msg.id;
        const proxyId = msg.proxyId;

        this.invokedHandlers[callId] = this.invokeHandler(proxyId, msg.method, msg.args);

        this.invokedHandlers[callId].then(r => {
            delete this.invokedHandlers[callId];
            this.multiplexor.send(MessageFactory.replyOK(callId, r));
        }, err => {
            delete this.invokedHandlers[callId];
            this.multiplexor.send(MessageFactory.replyErr(callId, err));
        });
    }

    private receiveReply(msg: ReplyMessage): void {
        const callId = msg.id;
        if (!this.pendingRPCReplies.hasOwnProperty(callId)) {
            return;
        }

        const pendingReply = this.pendingRPCReplies[callId];
        delete this.pendingRPCReplies[callId];

        pendingReply.resolveOk(msg.res);
    }

    private receiveReplyErr(msg: ReplyErrMessage): void {
        const callId = msg.id;
        if (!this.pendingRPCReplies.hasOwnProperty(callId)) {
            return;
        }

        const pendingReply = this.pendingRPCReplies[callId];
        delete this.pendingRPCReplies[callId];

        let err: Error | null = null;
        if (msg.err && msg.err.$isError) {
            err = new Error();
            err.name = msg.err.name;
            err.message = msg.err.message;
            err.stack = msg.err.stack;
        }
        pendingReply.resolveErr(err);
    }

    private invokeHandler(proxyId: string, methodName: string, args: any[]): Promise<any> {
        try {
            return Promise.resolve(this.doInvokeHandler(proxyId, methodName, args));
        } catch (err) {
            return Promise.reject(err);
        }
    }

    private doInvokeHandler(proxyId: string, methodName: string, args: any[]): any {
        if (!this.locals[proxyId]) {
            throw new Error('Unknown actor ' + proxyId);
        }
        const actor = this.locals[proxyId];
        const method = actor[methodName];
        if (typeof method !== 'function') {
            throw new Error('Unknown method ' + methodName + ' on actor ' + proxyId);
        }
        return method.apply(actor, args);
    }
}

function canceled(): Error {
    const error = new Error('Canceled');
    error.name = error.message;
    return error;
}

/**
 * Sends/Receives multiple messages in one go:
 *  - multiple messages to be sent from one stack get sent in bulk at `process.nextTick`.
 *  - each incoming message is handled in a separate `process.nextTick`.
 */
class RPCMultiplexer {

    private readonly connection: MessageConnection;
    private readonly sendAccumulatedBound: () => void;

    private messagesToSend: string[];

    constructor(connection: MessageConnection, onMessage: (msg: string) => void) {
        this.connection = connection;
        this.sendAccumulatedBound = this.sendAccumulated.bind(this);

        this.messagesToSend = [];

        this.connection.onMessage((data: string[]) => {
            const len = data.length;
            for (let i = 0; i < len; i++) {
                onMessage(data[i]);
            }
        });
    }

    private sendAccumulated(): void {
        const tmp = this.messagesToSend;
        this.messagesToSend = [];
        this.connection.send(tmp);
    }

    public send(msg: string): void {
        if (this.messagesToSend.length === 0) {
            setImmediate(this.sendAccumulatedBound);
        }
        this.messagesToSend.push(msg);
    }
}

class MessageFactory {

    public static request(req: string, rpcId: string, method: string, args: any[]): string {
        return `{"type":${MessageType.Request},"id":"${req}","proxyId":"${rpcId}","method":"${method}","args":${JSON.stringify(args)}}`;
    }

    public static replyOK(req: string, res: any): string {
        if (typeof res === 'undefined') {
            return `{"type":${MessageType.Reply},"id":"${req}"}`;
        }
        return `{"type":${MessageType.Reply},"id":"${req}","res":${JSON.stringify(res)}}`;
    }

    public static replyErr(req: string, err: any): string {
        if (err instanceof Error) {
            return `{"type":${MessageType.ReplyErr},"id":"${req}","err":${JSON.stringify(transformErrorForSerialization(err))}}`;
        }
        return `{"type":${MessageType.ReplyErr},"id":"${req}","err":null}`;
    }
}

const enum MessageType {
    Request = 1,
    Reply = 2,
    ReplyErr = 3
}

class RequestMessage {
    type: MessageType.Request;
    id: string;
    proxyId: string;
    method: string;
    args: any[];
}

class ReplyMessage {
    type: MessageType.Reply;
    id: string;
    res: any;
}

class ReplyErrMessage {
    type: MessageType.ReplyErr;
    id: string;
    err: SerializedError;
}

type RPCMessage = RequestMessage | ReplyMessage | ReplyErrMessage;

export interface SerializedError {
    readonly $isError: true;
    readonly name: string;
    readonly message: string;
    readonly stack: string;
}

export function transformErrorForSerialization(error: Error): SerializedError {
    if (error instanceof Error) {
        const { name, message } = error;
        const stack: string = (<any>error).stacktrace || error.stack;
        return {
            $isError: true,
            name,
            message,
            stack
        };
    }

    // return as is
    return error;
}
