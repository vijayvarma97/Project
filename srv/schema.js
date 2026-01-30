const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
    const { Tasks, Projects } = this.entities;

    // -----------------------------------------------------------------------
    // 1. HELPER: Recursive Project ID Assignment
    // -----------------------------------------------------------------------
    // This ensures that when you create a Project with nested Tasks, 
    // the 'project_ID' is correctly stamped on every single child task.
    function assignProjectID(tasks, projectId) {
        if (!tasks || !Array.isArray(tasks)) return;

        tasks.forEach(task => {
            // 1. Assign the Project ID to the current task
            task.project_ID = projectId;

            // 2. If this task has children (sub-tasks), recurse down
            if (task.children) {
                assignProjectID(task.children, projectId);
            }
        });
    }

    // -----------------------------------------------------------------------
    // 2. HELPER: Recursive Progress Calculation
    // -----------------------------------------------------------------------
    // Recalculates progress from the bottom up (Child -> Parent -> Project)
    async function updateParentProgress(parentId, req) {
        if (!parentId) return;

        // A. Check if the parent is a Task or a Project
        // We first try to find a Task with this ID
        const parentTask = await req.tx.run(SELECT.one.from(Tasks).where({ ID: parentId }));

        if (parentTask) {
            // --- LOGIC FOR TASK PARENTS ---
            // 1. Get all children of this task
            const children = await req.tx.run(
                SELECT.from(Tasks).where({ parent_ID: parentId })
            );

            if (children.length > 0) {
                // 2. Calculate Average
                const totalProgress = children.reduce((sum, task) => sum + (task.progress || 0), 0);
                const avgProgress = Math.round(totalProgress / children.length);

                // 3. Update the Parent Task
                await req.tx.run(
                    UPDATE(Tasks).set({ progress: avgProgress }).where({ ID: parentId })
                );
            }

            // 4. Recurse up (Check if this parent task has another parent)
            if (parentTask.parent_ID) {
                await updateParentProgress(parentTask.parent_ID, req);
            } else if (parentTask.project_ID) {
                // If it's a top-level task, update the Project next
                // Note: You might want to skip this if Projects don't track integer progress
                // But if you want to, you'd call a project update function here.
            }
        }
    }

    // -----------------------------------------------------------------------
    // 3. EVENT HANDLER: Before Creating/Updating Projects
    // -----------------------------------------------------------------------
    this.before(['CREATE', 'UPDATE'], 'Projects', (req) => {
        const projectData = req.data;
        
        // Ensure we generate an ID if it doesn't exist yet (for Create)
        if (!projectData.ID) projectData.ID = cds.utils.uuid();

        // If tasks are being created alongside the project (Deep Insert)
        if (projectData.tasks) {
            assignProjectID(projectData.tasks, projectData.ID);
        }
    });

    // -----------------------------------------------------------------------
    // 4. EVENT HANDLER: Before Creating Tasks (Directly)
    // -----------------------------------------------------------------------
    this.before(['CREATE', 'UPDATE'], 'Tasks', async (req) => {
        const taskData = req.data;

        // If a task is created with a parent_ID but NO project_ID,
        // we must fetch the Project ID from the parent to keep the tree intact.
        if (taskData.parent_ID && !taskData.project_ID) {
            const parent = await SELECT.one.from(Tasks)
                .where({ ID: taskData.parent_ID })
                .columns('project_ID');
            
            if (parent) {
                taskData.project_ID = parent.project_ID;
            }
        }
    });

    // -----------------------------------------------------------------------
    // 5. EVENT HANDLER: After Updating Tasks (Progress Automation)
    // -----------------------------------------------------------------------
    this.after(['UPDATE'], 'Tasks', async (data, req) => {
        // If the task has a parent, we must check if the parent's progress needs updating
        // We check 'data.parent_ID' (from payload) or fetch it if missing
        let parentId = data.parent_ID;

        // If the update payload didn't include parent_ID, we might need to fetch it
        // However, usually, for progress updates, we just need to know the parent exists.
        if (!parentId) {
            const task = await req.tx.run(SELECT.one.from(Tasks).where({ID: data.ID}).columns('parent_ID'));
            if(task) parentId = task.parent_ID;
        }

        if (parentId) {
            await updateParentProgress(parentId, req);
        }
    });
});