/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import '../../src/browser/style/index.css';

import { ContainerModule, interfaces } from 'inversify';
import { DebugConfigurationManager } from './debug-configuration-manager';
import { DebugWidget } from './view/debug-widget';
import { DebugPath, DebugService } from '../common/debug-service';
import { WidgetFactory, WebSocketConnectionProvider, FrontendApplicationContribution, bindViewContribution, KeybindingContext } from '@theia/core/lib/browser';
import { DebugSessionManager } from './debug-session-manager';
import { DebugResourceResolver } from './debug-resource';
import { DebugSessionContribution, DebugSessionFactory, DefaultDebugSessionFactory } from './debug-session-contribution';
import { bindContributionProvider, ResourceResolver } from '@theia/core';
import { DebugFrontendApplicationContribution } from './debug-frontend-application-contribution';
import { DebugConsoleContribution } from './console/debug-console-contribution';
import { BreakpointManager } from './breakpoint/breakpoint-manager';
import { DebugEditorService } from './editor/debug-editor-service';
import { DebugViewOptions } from './view/debug-view-model';
import { DebugSessionWidget, DebugSessionWidgetFactory } from './view/debug-session-widget';
import { InDebugModeContext } from './debug-keybinding-contexts';
import { DebugEditorModelFactory, DebugEditorModel } from './editor/debug-editor-model';

export default new ContainerModule((bind: interfaces.Bind) => {
    bindContributionProvider(bind, DebugSessionContribution);
    bind(DebugSessionFactory).to(DefaultDebugSessionFactory).inSingletonScope();
    bind(DebugSessionManager).toSelf().inSingletonScope();

    bind(BreakpointManager).toSelf().inSingletonScope();
    bind(DebugEditorModelFactory).toDynamicValue(({ container }) => <DebugEditorModelFactory>(editor =>
        DebugEditorModel.createModel(container, editor)
    )).inSingletonScope();
    bind(DebugEditorService).toSelf().inSingletonScope();

    bind(DebugSessionWidgetFactory).toDynamicValue(({ container }) =>
        (options: DebugViewOptions) => DebugSessionWidget.createWidget(container, options)
    ).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(({ container }) => ({
        id: DebugWidget.ID,
        createWidget: () => DebugWidget.createWidget(container)
    })).inSingletonScope();
    DebugConsoleContribution.bindContribution(bind);

    bind(DebugConfigurationManager).toSelf().inSingletonScope();

    bind(DebugService).toDynamicValue(context => WebSocketConnectionProvider.createProxy(context.container, DebugPath)).inSingletonScope();
    bind(DebugResourceResolver).toSelf().inSingletonScope();
    bind(ResourceResolver).toService(DebugResourceResolver);

    bind(KeybindingContext).to(InDebugModeContext).inSingletonScope();
    bindViewContribution(bind, DebugFrontendApplicationContribution);
    bind(FrontendApplicationContribution).toService(DebugFrontendApplicationContribution);
});
