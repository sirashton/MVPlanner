(function() {
    const vscode = acquireVsCodeApi();
    const plan = JSON.parse(document.getElementById('plan-data').textContent);
    
    // Retrieve the state
    let state = vscode.getState() || { expandedItems: {} };

    function createTreeItem(item, path = '') {
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

        // Add path display (now using only indices)
        const pathSpan = document.createElement('span');
        pathSpan.className = 'task-path';
        pathSpan.textContent = path;
        content.appendChild(pathSpan);

        div.appendChild(content);

        if (item.subtasks && item.subtasks.length) {
            const subtasks = document.createElement('div');
            subtasks.className = 'tree';
            const isExpanded = state.expandedItems[path] || false;
            subtasks.style.display = isExpanded ? 'block' : 'none';
            expandBtn.textContent = isExpanded ? '▼' : '▶';
            item.subtasks.forEach((subtask, index) => {
                const childPath = path ? `${path}.${index}` : `${index}`;
                subtasks.appendChild(createTreeItem(subtask, childPath));
            });
            div.appendChild(subtasks);

            expandBtn.addEventListener('click', () => {
                const newState = subtasks.style.display === 'none';
                expandBtn.textContent = newState ? '▼' : '▶';
                subtasks.style.display = newState ? 'block' : 'none';
                state.expandedItems[path] = newState;
                vscode.setState(state);
            });
        }

        return div;
    }

    const planTree = document.getElementById('plan-tree');
    planTree.appendChild(createTreeItem(plan));
})();

