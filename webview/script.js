(function() {
    const vscode = acquireVsCodeApi();
    const plan = JSON.parse(document.getElementById('plan-data').textContent);
    
    // Retrieve the state
    let state = vscode.getState() || { expandedItems: {} };

    function renderTree(node, parentPath = []) {
        const currentPath = [...parentPath, node.name];
        const pathString = currentPath.join(' > ');
        const isExpanded = state.expandedItems[pathString] || false;
        
        let html = `
            <div class="tree-item" data-path="${pathString}">
                <div class="tree-content">
                    <span class="expand-btn">${node.subtasks && node.subtasks.length ? (isExpanded ? '▼' : '▶') : '•'}</span>
                    <span class="task-name">${node.name}</span>
                    <span class="task-status">${node.status}</span>
                    <span class="task-mscw">${node.mscw}</span>
                    <span class="task-path">${pathString}</span>
                    <button class="complete-btn" data-path="${pathString}">Complete</button>
                </div>
            `;

        if (node.subtasks && node.subtasks.length) {
            html += `<div class="tree" style="display: ${isExpanded ? 'block' : 'none'};">`;
            for (const subtask of node.subtasks) {
                html += renderTree(subtask, currentPath);
            }
            html += `</div>`;
        }

        html += `</div>`;
        return html;
    }

    function initializeTree() {
        const treeContainer = document.getElementById('plan-tree');
        treeContainer.innerHTML = renderTree(plan);

        treeContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('expand-btn')) {
                const treeItem = e.target.closest('.tree-item');
                const subtree = treeItem.querySelector('.tree');
                const path = treeItem.dataset.path;
                if (subtree) {
                    const isExpanded = subtree.style.display !== 'none';
                    subtree.style.display = isExpanded ? 'none' : 'block';
                    e.target.textContent = isExpanded ? '▶' : '▼';
                    state.expandedItems[path] = !isExpanded;
                    vscode.setState(state);
                }
            } else if (e.target.classList.contains('complete-btn')) {
                const path = e.target.dataset.path;
                vscode.postMessage({
                    command: 'changeStatus',
                    path: path,
                    newStatus: 'Complete'
                });
            }
        });
    }

    initializeTree();

    // // Handle messages from the extension
    // window.addEventListener('message', event => {
    //     const message = event.data;
    //     switch (message.command) {
    //         case 'updatePlan':
    //             plan = message.plan;
    //             initializeTree();
    //             break;
    //     }
    // });
})();
