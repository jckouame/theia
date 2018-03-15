/*
 * Copyright (C) 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License'); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable, postConstruct } from 'inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Event, Emitter } from '@theia/core/lib/common/event';
import { Tree, TreeNode } from '@theia/core/lib/browser/tree/tree';
import { TreeDecorator, TreeDecoration } from '@theia/core/lib/browser/tree/tree-decorator';
import { TopDownTreeIterator } from '@theia/core/lib/browser';
import { FuzzySearch } from './fuzzy-search';

export namespace FileNavigatorSearch {

    /**
     * Representation of the file navigator search engine.
     * Executes a fuzzy search based on the expanded state of the tree and resolves to the tree nodes that match the search pattern
     */
    export const Engine = Symbol('FileNavigatorSearch.Engine');
    export interface Engine extends Disposable {

        /**
         * Resolves to all the visible tree nodes that match the search pattern.
         */
        filter(pattern: string | undefined): Promise<ReadonlyArray<Readonly<TreeNode>>>;

        /**
         * Returns with the filtered nodes after invoking the `filter` method or `undefined` if
         * no filter is set.
         */
        readonly filteredNodes: ReadonlyArray<Readonly<TreeNode>>;

        /**
         * Event that is fired when the filtered nodes have been changed.
         */
        readonly onFilteredNodesChanged: Event<ReadonlyArray<Readonly<TreeNode>>>;

    }

    /**
     * Options for the search term throttle.
     */
    @injectable()
    export class ThrottleOptions {

        /**
         * The delay (in milliseconds) before the throttle notifies clients about its content change.
         */
        readonly delay: number;

    }

    export namespace ThrottleOptions {

        /**
         * The default throttle option.
         */
        export const DEFAULT: ThrottleOptions = {
            delay: 50
        };

    }

    /**
     * The search term throttle. It notifies clients if the underlying search term has changed after a given
     * amount of delay.
     */
    @injectable()
    export class Throttle implements Disposable {

        protected readonly disposables = new DisposableCollection();
        protected readonly emitter = new Emitter<string | undefined>();

        protected timer: number | undefined;
        protected state: string | undefined;

        constructor(@inject(ThrottleOptions) protected readonly options: ThrottleOptions) {
            this.disposables.push(this.emitter);
        }

        append(input: string | undefined): string | undefined {
            if (input === undefined) {
                this.reset();
                return undefined;
            }
            this.clearTimer();
            if (this.state === undefined) {
                this.state = input;
            } else {
                if (input === '\b') {
                    this.state = this.state.length === 1 ? '' : this.state.substr(0, this.state.length - 1);
                } else {
                    this.state += input;
                }
            }
            this.timer = window.setTimeout(() => this.fireChanged(this.state), this.options.delay);
            return this.state;
        }

        get onChanged(): Event<string | undefined> {
            return this.emitter.event;
        }

        dispose(): void {
            this.disposables.dispose();
        }

        protected fireChanged(value: string | undefined) {
            this.clearTimer();
            this.emitter.fire(value);
        }

        protected clearTimer() {
            if (this.timer) {
                window.clearTimeout(this.timer);
                this.timer = undefined;
            }
        }

        protected reset() {
            this.state = undefined;
            this.fireChanged(undefined);
        }

    }

}

export namespace FileNavigatorSearch {

    @injectable()
    export class EngineImpl implements Engine, TreeDecorator {

        readonly id = 'theia-navigator-search-decorator';

        @inject(Tree)
        protected readonly tree: Tree;
        @inject(FuzzySearch.Search)
        protected readonly fuzzySearch: FuzzySearch.Search;

        protected readonly disposables = new DisposableCollection();
        protected readonly decorationEmitter = new Emitter<(tree: Tree) => Map<string, TreeDecoration.Data>>();
        protected readonly filteredNodesEmitter = new Emitter<ReadonlyArray<Readonly<TreeNode>>>();

        protected _filteredNodes: ReadonlyArray<Readonly<TreeNode>> = [];

        @postConstruct()
        init() {
            this.disposables.pushAll([
                this.decorationEmitter,
                this.filteredNodesEmitter,
                this.tree.onChanged(() => this.filter(undefined))
            ]);
        }

        async filter(pattern: string | undefined): Promise<ReadonlyArray<Readonly<TreeNode>>> {
            const { root } = this.tree;
            if (!pattern || !root) {
                this.fireDidChangeDecorations((tree: Tree) => new Map());
                this._filteredNodes = [];
                this.fireFilteredNodesChanged(this._filteredNodes);
                return [];
            }
            const items = [...new TopDownTreeIterator(root, { pruneCollapsed: true })];
            const transform = (node: TreeNode) => node.name;
            const result = await this.fuzzySearch.filter({
                items,
                pattern,
                transform
            });
            this.fireDidChangeDecorations((tree: Tree) => new Map(result.map(m => [m.item.id, this.toDecorator(m)] as [string, TreeDecoration.Data])));
            this._filteredNodes = result.map(match => match.item);
            this.fireFilteredNodesChanged(this._filteredNodes);
            return this._filteredNodes!.slice();
        }

        get onDidChangeDecorations(): Event<(tree: Tree) => Map<string, TreeDecoration.Data>> {
            return this.decorationEmitter.event;
        }

        get filteredNodes(): ReadonlyArray<Readonly<TreeNode>> {
            return this._filteredNodes.slice();
        }

        get onFilteredNodesChanged(): Event<ReadonlyArray<Readonly<TreeNode>>> {
            return this.filteredNodesEmitter.event;
        }

        dispose() {
            this.disposables.dispose();
        }

        protected fireDidChangeDecorations(event: (tree: Tree) => Map<string, TreeDecoration.Data>): void {
            this.decorationEmitter.fire(event);
        }

        protected fireFilteredNodesChanged(nodes: ReadonlyArray<Readonly<TreeNode>>): void {
            this.filteredNodesEmitter.fire(nodes);
        }

        protected toDecorator(match: FuzzySearch.Match<TreeNode>): TreeDecoration.Data {
            return {
                highlight: {
                    ranges: match.ranges.map(this.mapRange.bind(this))
                }
            };
        }

        protected mapRange(range: FuzzySearch.Range): TreeDecoration.CaptionHighlight.Range {
            const { offset, length } = range;
            return {
                offset,
                length
            };
        }

    }

}
