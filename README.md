# Project Planner VS Code Extension

## Overview
It's hard to stick to a longer term action plan, especially when working with AI assistants.
I find myself working with an AI to create a multistep plan that breaks down a big feature change, then writing this down somewhere to refer to, or sketching it out on paper. But what if you and your AI can be looking at the same plan, better still, what if you're just guiding the AI to build this nice structured plan?
MVPlanner is a VS Code extension designed to help developers and teams manage project tasks, visualize project plans, and integrate TODO comments with project planning. It aims to streamline the project management process directly within the development environment, visible to humans and agents alike.

## Key Features
1. Interactive Plan Viewer: Visualize sand edit your project plan within VS Code.
2. TODO Integration: Automatically link TODO comments in your code with tasks in your project plan.
3. Task Linting: Ensure TODOs in your code are properly tracked in the project plan.
4. Make the plan as easy as possible for AI code assistants to edit via structure json file.

## High-Level Aims
- Provide an intuitive, visual representation of project tasks and their hierarchy.
- Seamlessly integrate project planning with the development workflow.
- Enhance code-to-task traceability through TODO comment integration.
- Offer real-time task status updates and plan modifications.
- Improve project oversight without leaving the coding environment.

## Planned Features
- Interactive task creation, editing, and status updates.
- Hierarchical task visualization with collapsible subtasks.
- TODO comment linting on file save.
- Task filtering and searching capabilities.
- Integration with VS Code's source control features for plan.json file management.

## Development Status
This project is currently in the initial development phase. Contributions and feedback are welcome!

## Installation (for development)
1. Clone the repository
2. Run `npm install`
3. Open the project in VS Code
4. Press F5 to run the extension in a new VS Code Development Host window

## Installation (for local use)

1. Download the latest `.vsix` file from [your chosen distribution method, e.g., GitHub releases]
2. Open VS Code
3. Go to the Extensions view (Ctrl+Shift+X)
4. Click on the "..." at the top-right of the Extensions view
5. Select "Install from VSIX..."
6. Choose the downloaded `.vsix` file
7. Reload VS Code when prompted

You can now use MVPlanner in any of your projects!

## Usage
[Usage instructions will be added as features are implemented]

## Contributing
[Contribution guidelines will be added as the project progresses]

## License
[License information to be determined]

## Understanding Task Priorities and Completion Status

In MVPlanner, we use the MSCW (Must, Should, Could, Won't) system to prioritize tasks. However, it's important to understand how these priorities work in a hierarchical structure:

1. The MSCW priority of a task only indicates its importance relative to its parent task.
2. A subtask's priority doesn't affect the overall project status if its parent task has a lower priority.

This allows for more nuanced project planning and prevents lower-priority features from blocking project completion.

### Example: The Whimsical World of Unnecessary Code Optimization

Imagine you're building a simple to-do list app. Your project plan might look like this:

1. Basic To-Do List Functionality (MUST)
   1.1. Add tasks (MUST)
   1.2. Mark tasks as complete (MUST)
   1.3. Delete tasks (SHOULD)

2. User Authentication (SHOULD)
   2.1. User registration (MUST)
   2.2. User login (MUST)
   2.3. Password reset (SHOULD)

3. Hyper-Optimized Task Sorting Algorithm (COULD)
   3.1. Implement quantum-inspired sorting algorithm (MUST)
   3.2. Integrate with quantum computer API (MUST)
   3.3. Achieve sorting speeds faster than the speed of light (SHOULD)
   3.4. Rewrite the laws of physics if necessary (COULD)

In this example, the "Hyper-Optimized Task Sorting Algorithm" is a COULD for the overall project. Even though its subtasks are marked as MUST and SHOULD, they don't affect the completion status of the main project goals.

This means you can confidently say "We've done all we MUST" for the project once you've completed the Basic To-Do List Functionality, even if you haven't started rewriting the laws of physics for your sorting algorithm!

This approach allows developers to dream big and plan for exciting features without losing sight of the core project requirements.
