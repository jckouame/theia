/*
 * Copyright (C) 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License'); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as fuzzy from 'fuzzy';
import { injectable } from 'inversify';

/**
 * Fuzzy searcher.
 */
export namespace FuzzySearch {

    /**
     * A range representing the match region.
     */
    export interface Range {

        /**
         * The zero based offset of the match region.
         */
        readonly offset: number;

        /**
         * The length of the match region.
         */
        readonly length: number;
    }

    /**
     * A fuzzy search match.
     */
    export interface Match<T> {

        /**
         * The original item.
         */
        readonly item: T;

        /**
         * An array of ranges representing the match regions.
         */
        readonly ranges: ReadonlyArray<Range>;
    }

    /**
     * The fuzzy search input.
     */
    export interface Input<T> {

        /**
         * The pattern to match.
         */
        readonly pattern: string;

        /**
         * The items to filter based on the `pattern`.
         */
        readonly items: ReadonlyArray<T>;

        /**
         * Function that extracts the string from the inputs which will be used to evaluate the fuzzy matching filter.
         */
        readonly transform: (item: T) => string;

    }

    /**
     * The fuzzy search filter.
     */
    export const Search = Symbol('FuzzySearch.Search');
    export interface Search {

        /**
         * Filters the input and returns with an array that contains all items that match the pattern.
         */
        filter<T>(input: Input<T>): Promise<ReadonlyArray<Match<T>>>;

    }

}

@injectable()
export class FuzzySearchImpl implements FuzzySearch.Search {

    private static readonly PRE = '\x01';
    private static readonly POST = '\x02';

    async filter<T>(input: FuzzySearch.Input<T>): Promise<FuzzySearch.Match<T>[]> {
        return fuzzy.filter(input.pattern, input.items.slice(), {
            pre: FuzzySearchImpl.PRE,
            post: FuzzySearchImpl.POST,
            extract: input.transform
        }).sort(this.sortResults.bind(this)).map(this.mapResult.bind(this));
    }

    protected sortResults<T>(left: fuzzy.FilterResult<T>, right: fuzzy.FilterResult<T>): number {
        return left.index - right.index;
    }

    protected mapResult<T>(result: fuzzy.FilterResult<T>): FuzzySearch.Match<T> {
        return {
            item: result.original,
            ranges: this.mapRanges(result.string)
        };
    }

    protected mapRanges(input: string): ReadonlyArray<FuzzySearch.Range> {
        const copy = input.split('').filter(s => s !== '');
        const ranges: FuzzySearch.Range[] = [];
        const validate = (pre: number, post: number) => {
            if (preIndex > postIndex || (preIndex === -1) !== (postIndex === -1)) {
                throw new Error(`Error when trying to map ranges. Escaped string was: '${input}. [${[...input].join('|')}]'`);
            }
        };
        let preIndex = copy.indexOf(FuzzySearchImpl.PRE);
        let postIndex = copy.indexOf(FuzzySearchImpl.POST);
        validate(preIndex, postIndex);
        while (preIndex !== -1 && postIndex !== -1) {
            ranges.push({
                offset: preIndex,
                length: postIndex - preIndex - 1
            });
            copy.splice(postIndex, 1);
            copy.splice(preIndex, 1);
            preIndex = copy.indexOf(FuzzySearchImpl.PRE);
            postIndex = copy.indexOf(FuzzySearchImpl.POST);
        }
        if (ranges.length === 0) {
            throw new Error(`Unexpected zero ranges for match-string: ${input}.`);
        }
        return ranges;
    }

}
