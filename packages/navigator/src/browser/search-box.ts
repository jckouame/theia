/*
 * Copyright (C) 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from 'inversify';
import { KeyCode, Key } from '@theia/core/lib/browser';
import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { Event, Emitter } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileNavigatorSearch } from './navigator-search';

export namespace SearchBox {

    /**
     * Search box widget factory.
     */
    export const Factory = Symbol('SearchBox.Factory');
    export interface Factory {

        /**
         * Creates a new search box widget with the given initializer properties.
         */
        (props: SearchBox.Props): SearchBox.Widget;

    }

    /**
     * Initializer properties for the search box widget.
     */
    @injectable()
    export class Props {

        /**
         * `true` if the input field is readonly. Otherwise, `false`. Defaults to `true`.
         */
        readonly readonly?: boolean;

        /**
         * Throttle delay (in milliseconds) that is used before notifying clients about search data updates.
         */
        readonly delay: number;

    }

    export namespace Props {

        /**
         * The default search box widget option.
         */
        export const DEFAULT: SearchBox.Props = {
            readonly: true,
            delay: 50
        };

    }

    /**
     * The search box widget.
     */
    @injectable()
    export class Widget extends BaseWidget {

        private static SPECIAL_KEYS = [
            Key.ESCAPE,
            Key.BACKSPACE
        ];

        protected readonly disposables = new DisposableCollection();
        protected readonly nextEmitter = new Emitter<void>();
        protected readonly previousEmitter = new Emitter<void>();
        protected readonly closeEmitter = new Emitter<void>();
        protected readonly textChangeEmitter = new Emitter<string | undefined>();
        protected readonly input: HTMLInputElement;

        constructor(
            @inject(SearchBox.Props) protected readonly props: SearchBox.Props,
            @inject(FileNavigatorSearch.Throttle) protected readonly throttle: FileNavigatorSearch.Throttle) {

            super();
            this.disposables.pushAll([
                this.nextEmitter,
                this.previousEmitter,
                this.closeEmitter,
                this.textChangeEmitter,
                this.throttle,
                this.throttle.onChanged(data => this.fireTextChange(data))
            ]);
            this.hide();
            this.update();
            const { input } = this.createContent();
            this.input = input;
        }

        dispose() {
            this.disposables.dispose();
        }

        get onPrevious(): Event<void> {
            return this.previousEmitter.event;
        }

        get onNext(): Event<void> {
            return this.nextEmitter.event;
        }

        get onClose(): Event<void> {
            return this.closeEmitter.event;
        }

        get onTextChange(): Event<string | undefined> {
            return this.textChangeEmitter.event;
        }

        get keyCodePredicate(): KeyCode.Predicate {
            return this.canHandle.bind(this);
        }

        protected firePrevious(): void {
            this.previousEmitter.fire(undefined);
        }

        protected fireNext(): void {
            this.nextEmitter.fire(undefined);
        }

        protected fireClose(): void {
            this.closeEmitter.fire(undefined);
        }

        protected fireTextChange(input: string | undefined): void {
            this.textChangeEmitter.fire(input);
        }

        handle(event: KeyboardEvent): void {
            const keyCode = KeyCode.createKeyCode(event);
            if (this.canHandle(keyCode)) {
                if (Key.equals(Key.ESCAPE, keyCode)) {
                    this.hide();
                } else {
                    this.show();
                    this.handleKey(keyCode);
                }
            }
        }

        protected handleArrowUp() {
            this.firePrevious();
        }

        protected handleArrowDown() {
            this.fireNext();
        }

        onBeforeHide(): void {
            this.throttle.append(undefined);
            this.fireClose();
        }

        protected handleKey(keyCode: KeyCode) {
            const { key } = keyCode;
            if (key) {
                const character = Key.equals(Key.BACKSPACE, keyCode) ? '\b' : Key.getEasyKey(key).easyString;
                const data = this.throttle.append(character);
                if (data) {
                    this.input.value = data;
                    this.update();
                } else {
                    this.hide();
                }
            }
        }

        protected canHandle(keyCode: KeyCode | undefined): boolean {
            if (keyCode === undefined) {
                return false;
            }
            const { ctrl, alt, meta } = keyCode;
            if (ctrl || alt || meta) {
                return false;
            }
            if (this.isPrintableChar(keyCode) || (this.isVisible && Widget.SPECIAL_KEYS.some(key => Key.equals(key, keyCode)))) {
                return true;
            }
            return false;
        }

        protected createContent(): {
            container: HTMLElement,
            input: HTMLInputElement,
            previous: HTMLElement,
            next: HTMLElement,
            close: HTMLElement
        } {

            this.addClass(SearchBox.Styles.SEARCH_BOX);

            const input = document.createElement('input');
            input.readOnly = true;
            input.onselectstart = () => false;
            input.type = 'text';
            input.classList.add(
                SearchBox.Styles.SEARCH_INPUT,
                SearchBox.Styles.NON_SELECTABLE
            );
            this.node.appendChild(input);

            const previous = document.createElement('div');
            previous.classList.add(
                SearchBox.Styles.BUTTON,
                SearchBox.Styles.BUTTON_PREVIOUS
            );
            previous.title = 'Previous (Up)';
            this.node.appendChild(previous);
            previous.onclick = () => this.firePrevious.bind(this);

            const next = document.createElement('div');
            next.classList.add(
                SearchBox.Styles.BUTTON,
                SearchBox.Styles.BUTTON_NEXT
            );
            next.title = 'Next (Down)';
            this.node.appendChild(next);
            next.onclick = () => this.fireNext.bind(this);

            const close = document.createElement('div');
            close.classList.add(
                SearchBox.Styles.BUTTON,
                SearchBox.Styles.BUTTON_CLOSE
            );
            close.title = 'Close (Escape)';
            this.node.appendChild(close);
            close.onclick = () => this.fireClose.bind(this);

            return {
                container: this.node,
                input,
                previous,
                next,
                close
            };

        }

        private isPrintableChar(input: KeyCode): boolean {
            const { key } = input;
            if (key) {
                const { keyCode } = key;
                return (keyCode > 47 && keyCode < 58)     // number keys
                    || (keyCode > 64 && keyCode < 91)     // letter keys
                    || (keyCode > 95 && keyCode < 112)    // numpad keys
                    || (keyCode > 185 && keyCode < 193)   // ;=,-./` (in order)
                    || (keyCode > 218 && keyCode < 223);  // [\]' (in order)
            }
            return false;
        }

    }

    /**
     * CSS classes for the search box widget.
     */
    export namespace Styles {

        export const SEARCH_BOX = 'theia-search-box';
        export const SEARCH_INPUT = 'theia-search-input';
        export const BUTTON = 'theia-search-button';
        export const BUTTON_PREVIOUS = 'theia-search-button-previous';
        export const BUTTON_NEXT = 'theia-search-button-next';
        export const BUTTON_CLOSE = 'theia-search-button-close';
        export const NON_SELECTABLE = 'theia-non-selectable';

    }

}
