console.log('Extension file is being loaded');
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Activating extension "mvplanner"...');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('mvplanner.helloWorld', () => {
		console.log('Hello World command was triggered!');
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from MVPlanner!');
	});

	context.subscriptions.push(disposable);

	console.log('Registered mvplanner.helloWorld command');

	// Try to execute the command programmatically
	vscode.commands.executeCommand('mvplanner.helloWorld').then(
		() => console.log('Successfully executed helloWorld command'),
		(error) => console.error('Failed to execute helloWorld command:', error)
	);

	console.log('Congratulations, your extension "mvplanner" is now active!');
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('Deactivating extension "mvplanner"...');
}
