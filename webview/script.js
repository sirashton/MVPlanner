(function() {
    const vscode = acquireVsCodeApi();
    const plan = JSON.parse(document.getElementById('plan-data').textContent);
    
    // Retrieve the state
    let state = vscode.getState() || { expandedItems: {} };

    const statusOptions = ['Not Started', 'In Progress', 'Complete', 'Blocked'];
    const mscwOptions = ['Must', 'Should', 'Could', 'Won\'t'];

    function countDescendantsAndSetDepth(node, depth = 0) {
        node.depth = depth;
        node.descendantCount = 0;

        if (node.subtasks && node.subtasks.length > 0) {
            for (const subtask of node.subtasks) {
                node.descendantCount += countDescendantsAndSetDepth(subtask, depth + 1) + 1;
            }
        }

        return node.descendantCount;
    }

    function calculateDoMore(node) {
        const mscwOrder = ['Must', 'Should', 'Could', 'Won\'t', 'Can\'t'];
        node.doMore = 'Not Calculated';

        if (!node.subtasks || node.subtasks.length === 0) {
            
            try {
                if (node.status === 'Complete') {
                    node.doMore = 'Can\'t';
                } else {
                    node.doMore = `${node.mscw}`;
                }
            } catch (error) {
                vscode.postMessage({
                    command: 'log',
                    message: `Error calculating do-more status for node: ${node.name}, Error: ${error.message}`
                });
                node.doMore = 'Error calculating do-more status';
            }
        }
        else { // If there are subtasks, we need to calculate the do-more status for each subtask
            for (const subtask of node.subtasks) {
                calculateDoMore(subtask);
            }

            // Check if done all we {level}
            for (const levelWereChecking of mscwOrder) { // For each level
                // Find all tasks that level or more important (lower index in mscwOrder)
                const tasksAtOrAboveLevel = node.subtasks.filter(subtask => mscwOrder.indexOf(subtask.mscw) <= mscwOrder.indexOf(levelWereChecking));
                
                // check if all those tasks have do-more status at least as important as the level we are checking
                // If no tasks then skip to next levelWereChecking
                if (tasksAtOrAboveLevel.length === 0) {
                    continue;
                }
                if (tasksAtOrAboveLevel.some(subtask => mscwOrder.indexOf(subtask.doMore) <= mscwOrder.indexOf(levelWereChecking))) {
                    node.doMore = `${levelWereChecking}`;
                    return node.doMore;
                }
            }
        }
    
        return node.doMore;
    }

    function renderTree(node, parentPath = []) {
        const currentPath = [...parentPath, node.name];
        const pathString = currentPath.join(' > ');
        const isExpanded = state.expandedItems[pathString] || false;
        
        let html = `
            <div class="tree-item" data-path="${pathString}">
                <div class="tree-content">
                    <span class="expand-btn">${node.subtasks && node.subtasks.length ? (isExpanded ? '▼' : '▶') : '•'}</span>
                    <span class="task-name">${node.name}</span>
                    <span class="task-info">(Depth: ${node.depth}, Descendants: ${node.descendantCount})</span>
                    <span class="do-more-status">${node.doMore} do more</span>
                    <select class="status-select" data-path="${pathString}">
                        ${statusOptions.map(status => 
                            `<option value="${status}" ${node.status === status ? 'selected' : ''}>${status}</option>`
                        ).join('')}
                    </select>
                    <select class="mscw-select" data-path="${pathString}">
                        ${mscwOptions.map(mscw => 
                            `<option value="${mscw}" ${node.mscw === mscw ? 'selected' : ''}>${mscw}</option>`
                        ).join('')}
                    </select>
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
            }
        });

        treeContainer.addEventListener('change', (e) => {
            if (e.target.classList.contains('status-select')) {
                const path = e.target.dataset.path;
                const newStatus = e.target.value;
                vscode.postMessage({
                    command: 'changeStatus',
                    path: path,
                    newStatus: newStatus
                });
            } else if (e.target.classList.contains('mscw-select')) {
                const path = e.target.dataset.path;
                const newMSCW = e.target.value;
                vscode.postMessage({
                    command: 'changeMSCW',
                    path: path,
                    newMSCW: newMSCW
                });
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        countDescendantsAndSetDepth(plan);
        try {
            calculateDoMore(plan);
        } catch (error) {
            vscode.postMessage({
                command: 'log',
                message: `Error calculating do-more status for entire plan: ${error.message}`
            });
        }
        initializeTree();
    });

})();
