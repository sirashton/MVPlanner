import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

const EXTENSION_DEV_VERSION = "0.0.32";
let planViewerPanel: vscode.WebviewPanel | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let planFilePath: string | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log(`Activating extension "mvplanner" version: ${EXTENSION_DEV_VERSION}...`);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder and try again.');
        return;
    }

    planFilePath = path.join(workspaceFolder.uri.fsPath, 'plan.json');
    console.log('Plan path:', planFilePath);

    async function updatePlanViewer() {
        if (!planViewerPanel) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        if (!planFilePath) {
            vscode.window.showErrorMessage('Plan file path is not set');
            return;
        }

        try {
            const planContent = await fs.readFile(planFilePath, 'utf-8');
            const plan = JSON.parse(planContent);
            const webviewContent = await getWebviewContent(context, plan);
            planViewerPanel.webview.html = webviewContent;
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
                    {
                        enableScripts: true,
                        enableCommandUris: true,
                        retainContextWhenHidden: true
                    }
                );

                planViewerPanel.webview.onDidReceiveMessage(
                    async message => {
                        switch (message.command) {
                            case 'changeStatus':
                                console.log(`Changing status for task: ${message.path} to ${message.newStatus}`);
                                await updateTaskStatus(message.path, message.newStatus);
                                return;
                        }
                    },
                    undefined,
                    context.subscriptions
                );

                planViewerPanel.onDidDispose(() => {
                    planViewerPanel = undefined;
                }, null, context.subscriptions);

                // Set up file watcher for plan.json
                if (!fileWatcher) {
                    if (planFilePath) {
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
    setupFileWatcher(context, planFilePath);

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
            // Display message to user on the webview that file has been deleted.
            planViewerPanel.webview.html = 'Plan file not found.';
        }
    });

    context.subscriptions.push(fileWatcher);
    console.log('File watcher for plan.json set up.');
}

async function getWebviewContent(context: vscode.ExtensionContext, plan: any): Promise<string> {
    const htmlPath = vscode.Uri.file(path.join(context.extensionPath, 'webview', 'index.html'));
    const stylesPath = vscode.Uri.file(path.join(context.extensionPath, 'webview', 'styles.css'));
    const scriptPath = vscode.Uri.file(path.join(context.extensionPath, 'webview', 'script.js'));

    console.log('Getting webview content...');
    console.log('typeof plan:', typeof plan);
    
    // Validate plan structure
    let planStructureError = null;
    if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
        planStructureError = 'Invalid plan structure: Top-level must be a single task object.';
    }

    // Ensure the plan object has a name property (minimum requirement for a task)
    if (typeof plan.name !== 'string') {
        planStructureError = 'Invalid plan structure: Task must have a name property.';
    }

    if (planStructureError) {
        vscode.window.showErrorMessage(planStructureError);
        const htmlContent = `
        <div class="error-container">
            <h2>Error in Plan Structure</h2>
            <p>${planStructureError}</p>
            <h3>How to Fix:</h3>
            <ul>
                <li>Ensure your plan.json file contains a single object (not an array).</li>
                <li>The top-level object should represent a task with at least a 'name' property.</li>
                <li>Example of a valid minimal structure:
                    <pre>
{
    "name": "My Project",
    "subtasks": [
        {
            "name": "Subtask 1"
        },
        {
            "name": "Subtask 2"
        }
    ]
}
                    </pre>
                </li>
                <li>Check your JSON for syntax errors.</li>
            </ul>
        </div>
    `;
        return htmlContent;
    }

    const htmlContent = await fs.readFile(htmlPath.fsPath, 'utf-8');
    if (!planViewerPanel) {
        // If the plan viewer is not open, doesn't matter what we return?
        return htmlContent;
    } else {
        const stylesUri = planViewerPanel.webview.asWebviewUri(stylesPath);
        const scriptUri = planViewerPanel.webview.asWebviewUri(scriptPath);

        const nonce = getNonce();

        return htmlContent
            .replace('${stylesUri}', stylesUri.toString())
            .replace('${scriptUri}', scriptUri.toString())
            .replace('${nonce}', nonce)
            .replace('${plan}', JSON.stringify(plan));
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {
    console.log('Deactivating extension "mvplanner"...');
    if (fileWatcher) {
        fileWatcher.dispose();
    }
}

async function updateTaskStatus(taskPath: string, newStatus: string) {
    if (!planFilePath) {
        vscode.window.showErrorMessage('Plan file path is not set');
        return;
    }

    try {
        const planContent = await fs.readFile(planFilePath, 'utf-8');
        let plan = JSON.parse(planContent);

        // Update the task status
        const pathParts = taskPath.split(' > ');
        let currentTask = plan;
        for (let i = 1; i < pathParts.length; i++) {
            const part = pathParts[i];
            if (currentTask.subtasks) {
                currentTask = currentTask.subtasks.find((task: any) => task.name === part);
                if (!currentTask) {
                    throw new Error(`Task not found: ${part}`);
                }
            } else {
                throw new Error(`Invalid task structure at: ${part}`);
            }
        }

        currentTask.status = newStatus;

        // Write the updated plan back to the file
        await fs.writeFile(planFilePath, JSON.stringify(plan, null, 2), 'utf-8');

        // Refresh the plan viewer
        vscode.commands.executeCommand('mvplanner.refreshPlanViewer');

        vscode.window.showInformationMessage(`Task status updated: ${taskPath} -> ${newStatus}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Error updating task status: ${error}`);
    }
}
