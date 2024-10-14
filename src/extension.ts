import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

const EXTENSION_DEV_VERSION = "0.0.21";
let planViewerPanel: vscode.WebviewPanel | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log(`Activating extension "mvplanner" version: ${EXTENSION_DEV_VERSION}...`);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder and try again.');
        return;
    }

    const planPath = path.join(workspaceFolder.uri.fsPath, 'plan.json');
    console.log('Plan path:', planPath);

    async function updatePlanViewer() {
        if (!planViewerPanel) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const planFilePath = path.join(workspaceFolders[0].uri.fsPath, 'plan.json');

        try {
            const planContent = await fs.readFile(planFilePath, 'utf-8');
            const planJson = JSON.parse(planContent);
            planViewerPanel.webview.html = getWebviewContent(planJson);
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading plan file: ${error}`);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('mvplanner.openPlanViewer', async () => {
            if (planViewerPanel) {
                planViewerPanel.reveal(vscode.ViewColumn.One);
            } else {
                planViewerPanel = vscode.window.createWebviewPanel(
                    'planViewer',
                    'Project Plan Viewer',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );

                planViewerPanel.onDidDispose(() => {
                    planViewerPanel = undefined;
                }, null, context.subscriptions);

                // Set up file watcher for plan.json
                if (!fileWatcher) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders) {
                        const planFilePath = path.join(workspaceFolders[0].uri.fsPath, 'plan.json');
                        fileWatcher = vscode.workspace.createFileSystemWatcher(planFilePath);
                        fileWatcher.onDidChange(() => {
                            updatePlanViewer();
                        });
                        context.subscriptions.push(fileWatcher);
                    }
                }
            }

            await updatePlanViewer();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mvplanner.refreshPlanViewer', async () => {
            await updatePlanViewer();
        })
    );

    // Set up file watcher
    setupFileWatcher(context, planPath);

    console.log('mvplanner.openPlanViewer and mvplanner.refreshPlanViewer commands registered');
}

async function ensurePlanFileExists(planPath: string): Promise<boolean> {
    console.log('Checking plan file:', planPath);

    try {
        // Check if the file exists, but must be a case sensitive match
        const files = await fs.readdir(path.dirname(planPath));
        const planFile = files.find(file => file === path.basename(planPath));
        if (!planFile) {
            throw new Error('plan.json not found');
        }

        const fileName = path.basename(planPath);
        if (fileName !== 'plan.json') {
            vscode.window.showErrorMessage('The plan file must be named exactly "plan.json" (all lowercase). Please rename your file and try again.');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error checking for plan.json:', error);
        vscode.window.showErrorMessage('plan.json not found in the workspace root. Please create a lowercase plan.json file and try again.');
        return false;
    }
}

function setupFileWatcher(context: vscode.ExtensionContext, planPath: string) {

    fileWatcher = vscode.workspace.createFileSystemWatcher(planPath);

    fileWatcher.onDidChange(() => {
        console.log('plan.json changed. Refreshing Plan Viewer.');
        vscode.commands.executeCommand('mvplanner.refreshPlanViewer');
    });

    fileWatcher.onDidDelete(() => {
        console.log('plan.json deleted. Updating Plan Viewer.');
        if (planViewerPanel) {
            planViewerPanel.webview.html = getWebviewContent('Plan file not found.');
        }
    });

    context.subscriptions.push(fileWatcher);
    console.log('File watcher for plan.json set up.');
}

function getWebviewContent(planData: string) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Project Plan Viewer</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            .tree { margin-left: 20px; }
            .tree-item { margin: 10px 0; }
            .tree-content { display: flex; align-items: center; }
            .expand-btn { cursor: pointer; margin-right: 5px; }
            .task-name { font-weight: bold; }
            .task-status { margin-left: 10px; font-style: italic; }
            .task-mscw { margin-left: 10px; }
        </style>
    </head>
    <body>
        <h1>Project Plan</h1>
        <div id="plan-tree"></div>

        <script>
            const plan = ${JSON.stringify(planData)};

            function createTreeItem(item) {
                const div = document.createElement('div');
                div.className = 'tree-item';

                const content = document.createElement('div');
                content.className = 'tree-content';

                const expandBtn = document.createElement('span');
                expandBtn.className = 'expand-btn';
                expandBtn.textContent = item.subtasks && item.subtasks.length ? '▶' : '•';
                content.appendChild(expandBtn);

                const name = document.createElement('span');
                name.className = 'task-name';
                name.textContent = item.name;
                content.appendChild(name);

                const status = document.createElement('span');
                status.className = 'task-status';
                status.textContent = item.status;
                content.appendChild(status);

                const mscw = document.createElement('span');
                mscw.className = 'task-mscw';
                mscw.textContent = item.mscw;
                content.appendChild(mscw);

                div.appendChild(content);

                if (item.subtasks && item.subtasks.length) {
                    const subtasks = document.createElement('div');
                    subtasks.className = 'tree';
                    subtasks.style.display = 'none';
                    item.subtasks.forEach(subtask => {
                        subtasks.appendChild(createTreeItem(subtask));
                    });
                    div.appendChild(subtasks);

                    expandBtn.addEventListener('click', () => {
                        expandBtn.textContent = expandBtn.textContent === '▶' ? '▼' : '▶';
                        subtasks.style.display = subtasks.style.display === 'none' ? 'block' : 'none';
                    });
                }

                return div;
            }

            const planTree = document.getElementById('plan-tree');
            planTree.appendChild(createTreeItem(plan));
        </script>
    </body>
    </html>`;
}

export function deactivate() {
    console.log('Deactivating extension "mvplanner"...');
    if (fileWatcher) {
        fileWatcher.dispose();
    }
}
