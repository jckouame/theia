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

/**
 * Representation of the file navigator search. Executes a fuzzy search based on the expanded state of the tree.
 */
export const FileNavigatorSearch = Symbol('FileNavigatorSearch');
export interface FileNavigatorSearch {

    /**
     * Notifies clients about the search term changes.
     */
    readonly onDidChangeSearchTerm: Event<string | undefined>;

    /**
     * Resolves when the search has been finished.
     */
    search(searchTerm: string | undefined): Promise<void>;

}

@injectable()
export class FileNavigatorSearchImpl implements FileNavigatorSearch, TreeDecorator {

    readonly id = 'theia-navigator-search-decorator';

    @inject(Tree)
    protected readonly tree: Tree;
    @inject(FuzzySearch.Search)
    protected readonly fuzzySearch: FuzzySearch.Search;

    protected readonly searchTermEmitter: Emitter<string | undefined> = new Emitter();
    protected readonly decorationEmitter: Emitter<(tree: Tree) => Map<string, TreeDecoration.Data>> = new Emitter();

    @postConstruct()
    protected init(): void {
        console.log('FileNavigatorSearchImpl#init');
    }

    async search(searchTerm: string | undefined): Promise<void> {
        console.log('SEARCH TERM', searchTerm);
        if (!searchTerm) {
            this.fireDidChangeSearchTerm(undefined);
            return;
        }
        const { root } = this.tree;
        if (!root) {
            this.fireDidChangeSearchTerm(undefined);
            return;
        }
        const items = [...new TopDownTreeIterator(root, { pruneCollapsed: true })];
        const pattern = searchTerm;
        const transform = (node: TreeNode) => node.name;
        const result = await this.fuzzySearch.filter({
            items,
            pattern,
            transform
        });
        this.fireDidChangeDecorations((tree: Tree) => new Map(result.map(m => [m.item.id, this.toDecorator(m)] as [string, TreeDecoration.Data])));
        this.fireDidChangeSearchTerm(searchTerm);
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

export namespace SearchTerm {

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
