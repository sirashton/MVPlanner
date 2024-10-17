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

    function getDoMoreRank(doMore) {
        const ranks = {
            'must': 0,
            'should': 1,
            'could': 2,
            'won\'t': 3,
            'can\'t': 4
        };
        return ranks[doMore.toLowerCase()] ?? 5; // Default to lowest priority if unknown
    }

    function renderTree(node, parentPath = [], parentDoMore = null) {
        const currentPath = [...parentPath, node.name];
        const pathString = currentPath.join(' > ');
        const isExpanded = state.expandedItems[pathString] || false;
        
        let doMoreClass = '';
        switch (node.doMore.toLowerCase()) {
            case 'must': doMoreClass = 'do-more-must'; break;
            case 'should': doMoreClass = 'do-more-should'; break;
            case 'could': doMoreClass = 'do-more-could'; break;
            case 'won\'t': doMoreClass = 'do-more-wont'; break;
            case 'can\'t': doMoreClass = 'do-more-cant'; break;
        }

        const matchesParentDoMore = parentDoMore === null || node.doMore.toLowerCase() === parentDoMore.toLowerCase();
        const titleClass = matchesParentDoMore ? 'task-name-highlight' : '';

        let html = `
            <div class="tree-item ${doMoreClass}">
                <div class="tree-content">
                    <span class="expand-btn">${node.subtasks && node.subtasks.length ? (isExpanded ? '▼' : '▶') : '•'}</span>
                    <span class="task-name ${titleClass}">${node.name}</span>
                    <span class="task-info">(Depth: ${node.depth}, Descendants: ${node.descendantCount})</span>
                    <span class="do-more-status ${doMoreClass}"><strong>${node.doMore}</strong> do more</span>
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
            // Sort subtasks by do-more status
            const sortedSubtasks = [...node.subtasks].sort((a, b) => {
                return getDoMoreRank(a.doMore) - getDoMoreRank(b.doMore);
            });

            html += `<div class="tree" style="display: ${isExpanded ? 'block' : 'none'};">`;
            for (const subtask of sortedSubtasks) {
                html += renderTree(subtask, currentPath, node.doMore);
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
                const path = treeItem.getAttribute('data-path');
                const subtree = treeItem.querySelector('.tree');
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

    function expandAll() {
        const allItems = document.querySelectorAll('.tree-item');
        allItems.forEach(item => {
            const path = item.getAttribute('data-path');
            if (path) {
                state.expandedItems[path] = true;
            }
            const subtree = item.querySelector('.tree');
            if (subtree) {
                subtree.style.display = 'block';
            }
            const expandBtn = item.querySelector('.expand-btn');
            if (expandBtn && expandBtn.textContent === '▶') {
                expandBtn.textContent = '▼';
            }
        });
        vscode.setState(state);
    }

    function collapseAll() {
        const allItems = document.querySelectorAll('.tree-item');
        allItems.forEach(item => {
            const path = item.getAttribute('data-path');
            if (path) {
                state.expandedItems[path] = false;
            }
            const subtree = item.querySelector('.tree');
            if (subtree) {
                subtree.style.display = 'none';
            }
            const expandBtn = item.querySelector('.expand-btn');
            if (expandBtn && expandBtn.textContent === '▼') {
                expandBtn.textContent = '▶';
            }
        });
        vscode.setState(state);
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

    document.getElementById('expand-all').addEventListener('click', () => {
        expandAll();
    });

    document.getElementById('collapse-all').addEventListener('click', () => {
        collapseAll();
    });
})();
