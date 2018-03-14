/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject } from "inversify";
import { h } from "@phosphor/virtualdom/lib";
import { Message } from "@phosphor/messaging";
import URI from "@theia/core/lib/common/uri";
import { SelectionService, CommandService } from '@theia/core/lib/common';
import { ContextMenuRenderer, TreeProps, TreeModel, TreeNode, LabelProvider, KeyCode, Widget, BaseWidget } from '@theia/core/lib/browser';
import { FileTreeWidget, DirNode } from "@theia/filesystem/lib/browser";
import { WorkspaceService, WorkspaceCommands } from '@theia/workspace/lib/browser';
import { FileNavigatorModel } from "./navigator-model";
import { FileNavigatorSearch } from './navigator-search';
import { DisposableCollection } from '@theia/core/lib/common/disposable';

export const FILE_NAVIGATOR_ID = 'files';
export const LABEL = 'Files';
export const CLASS = 'theia-Files';

@injectable()
export class FileNavigatorWidget extends FileTreeWidget {

    protected readonly disposables = new DisposableCollection();
    protected searchBox: SearchBox;

    constructor(
        @inject(TreeProps) readonly props: TreeProps,
        @inject(FileNavigatorModel) readonly model: FileNavigatorModel,
        @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
        @inject(CommandService) protected readonly commandService: CommandService,
        @inject(SelectionService) protected readonly selectionService: SelectionService,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(LabelProvider) protected readonly labelProvider: LabelProvider,
        @inject(FileNavigatorSearch.Engine) protected readonly searchEngine: FileNavigatorSearch.Engine,
        @inject(FileNavigatorSearch.Throttle) protected readonly throttle: FileNavigatorSearch.Throttle
    ) {
        super(props, model, contextMenuRenderer);
        this.id = FILE_NAVIGATOR_ID;
        this.title.label = LABEL;
        this.addClass(CLASS);
        this.initialize();
        this.disposables.push(throttle);
        throttle.onChanged(searchTerm => this.searchEngine.filter(searchTerm));
    }

    protected initialize(): void {
        this.model.onSelectionChanged(selection =>
            this.selectionService.selection = selection
        );

        this.workspaceService.root.then(async resolvedRoot => {
            if (resolvedRoot) {
                const uri = new URI(resolvedRoot.uri);
                const label = this.labelProvider.getName(uri);
                const icon = await this.labelProvider.getIcon(resolvedRoot);
                this.model.root = DirNode.createRoot(resolvedRoot, label, icon);
            } else {
                this.update();
            }
        });
    }

    dispose(): void {
        super.dispose();
        this.disposables.dispose();
    }

    protected deflateForStorage(node: TreeNode): object {
        // tslint:disable-next-line:no-any
        const copy = { ...node } as any;
        if (copy.uri) {
            copy.uri = copy.uri.toString();
        }
        return super.deflateForStorage(copy);
    }

    // tslint:disable-next-line:no-any
    protected inflateFromStorage(node: any, parent?: TreeNode): TreeNode {
        if (node.uri) {
            node.uri = new URI(node.uri);
        }
        return super.inflateFromStorage(node, parent);
    }

    protected renderTree(model: TreeModel): h.Child {
        return super.renderTree(model) || this.renderOpenWorkspaceDiv();
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.addClipboardListener(this.node, 'copy', e => this.handleCopy(e));
        this.addClipboardListener(this.node, 'paste', e => this.handlePaste(e));
        this.addKeyListener(this.node, (keyCode: KeyCode) => true, e => {
            const keyCode = KeyCode.createKeyCode(e);
            if (KeyCode.PRINTABLE(keyCode)) {
                this.searchBox.updateData(this.throttle.update(e.key));
            } else {
                this.searchBox.updateData(this.throttle.update(undefined));
            }
        });
        this.searchBox = new SearchBox(this.node);
        this.disposables.push(this.searchBox);
        this.searchBox.hide();
    }

    protected handleCopy(event: ClipboardEvent): void {
        const uris = this.model.selectedFileStatNodes.map(node => node.uri.toString());
        if (uris.length > 0) {
            event.clipboardData.setData('text/plain', uris.join('\n'));
            event.preventDefault();
        }
    }

    protected handlePaste(event: ClipboardEvent): void {
        const raw = event.clipboardData.getData('text/plain');
        if (raw) {
            const uri = new URI(raw);
            if (this.model.copy(uri)) {
                event.preventDefault();
            }
        }
    }

    /**
     * Instead of rendering the file resources form the workspace, we render a placeholder
     * button when the workspace root is not yet set.
     */
    protected renderOpenWorkspaceDiv(): h.Child {
        const button = h.button({
            className: 'open-workspace-button',
            title: 'Select a directory as your workspace root',
            onclick: e => this.commandService.executeCommand(WorkspaceCommands.OPEN.id)
        }, 'Open Workspace');
        const buttonContainer = h.div({ className: 'open-workspace-button-container' }, button);
        return h.div({ className: 'theia-navigator-container' }, 'You have not yet opened a workspace.', buttonContainer);
    }

}

export class SearchBox extends BaseWidget {

    protected contentNode: HTMLDivElement;
    protected hidden: boolean;

    constructor(host: HTMLElement) {
        super();
        this.addClass(SearchBox.Styles.SEARCH_BOX_CLASS);
        this.contentNode = document.createElement('div');
        this.contentNode.innerHTML = 'Search for:';
        this.node.appendChild(this.contentNode);
        Widget.attach(this, host);
        this.hide();
        this.update();
    }

    updateData(data: string | undefined): void {
        if (data === undefined) {
            this.hide();
            return;
        }
        this.show();
        this.contentNode.innerHTML = `Search for: ${data}`;
        this.update();
    }

}

export namespace SearchBox {
    export namespace Styles {
        export const SEARCH_BOX_CLASS = 'theia-search-box';
    }
}
