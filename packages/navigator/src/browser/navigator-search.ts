/*
 * Copyright (C) 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License'); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from 'inversify';
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
    export interface Engine {

        /**
         * Notifies clients about the search term changes.
         */
        readonly onDidChangeSearchTerm: Event<string | undefined>;

        /**
         * Resolves to all the visible tree nodes that match the search pattern.
         */
        filter(pattern: string | undefined): Promise<ReadonlyArray<Readonly<TreeNode>>>;

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
            delay: 300
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

        update(input: string | undefined): void {
            if (input === undefined) {
                this.reset();
                return;
            }
            this.clearTimer();
            if (this.state) {
                this.state += input;
            } else {
                this.state = input;
            }
            this.timer = window.setTimeout(() => this.fireChanged(this.state), this.options.delay);
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

        protected readonly searchTermEmitter: Emitter<string | undefined> = new Emitter();
        protected readonly decorationEmitter: Emitter<(tree: Tree) => Map<string, TreeDecoration.Data>> = new Emitter();

        async filter(pattern: string | undefined): Promise<ReadonlyArray<Readonly<TreeNode>>> {
            const { root } = this.tree;
            if (!pattern || !root) {
                this.fireDidChangeDecorations((tree: Tree) => new Map());
                this.fireDidChangeSearchTerm(undefined);
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
            this.fireDidChangeSearchTerm(pattern);
            return result.map(match => match.item);
        }

        get onDidChangeSearchTerm(): Event<string | undefined> {
            return this.searchTermEmitter.event;
        }

        get onDidChangeDecorations(): Event<(tree: Tree) => Map<string, TreeDecoration.Data>> {
            return this.decorationEmitter.event;
        }

        protected fireDidChangeSearchTerm(searchTerm: string | undefined) {
            this.searchTermEmitter.fire(searchTerm);
        }

        protected fireDidChangeDecorations(event: (tree: Tree) => Map<string, TreeDecoration.Data>): void {
            this.decorationEmitter.fire(event);
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
