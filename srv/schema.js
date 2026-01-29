const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    // Helper function to recursively assign Project ID
    function assignProjectID(tasks, projectId) {
        if (!tasks || !Array.isArray(tasks)) return;

        tasks.forEach(task => {
            // 1. Assign the Project ID to the current task
            task.project_ID = projectId;

            // 2. If this task has children, recurse down
            if (task.children) {
                assignProjectID(task.children, projectId);
            }
        });
    }

    // Hook: Before Creating or Updating a Project
    this.before(['CREATE', 'UPDATE'], 'Projects', (req) => {
        const projectData = req.data;
        
        // Ensure we have an ID and tasks to process
        if (projectData.ID && projectData.tasks) {
            assignProjectID(projectData.tasks, projectData.ID);
        }
    });

    // Hook: Before Creating tasks directly (if you POST to /Tasks)
    this.before(['CREATE', 'UPDATE'], 'Tasks', async (req) => {
        // If we are creating a sub-task directly, we might need to fetch the parent's Project ID
        // This is the logic I gave previously, kept here for safety in non-deep-insert scenarios
        if (req.data.parent_ID && !req.data.project_ID) {
            const parent = await SELECT.one.from('my.employeehub.Tasks')
                .where({ ID: req.data.parent_ID })
                .columns('project_ID');
            
            if (parent) req.data.project_ID = parent.project_ID;
        }
    });
});