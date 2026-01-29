const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    // 1. Hook into the 'Tasks' entity before it is saved
    this.before(['CREATE', 'UPDATE'], 'Tasks', async (req) => {
        const tx = cds.transaction(req);
        const { parent_ID, project_ID } = req.data;

        // Condition: If a task has a Parent but NO Project ID (it's a sub-task)
        if (parent_ID && !project_ID) {
            
            // Look up the Parent Task to find its project_ID
            // Note: We use 'req.target' to refer to the Tasks entity dynamically
            const parentTask = await tx.run(
                SELECT.one.from(req.target).where({ ID: parent_ID }).columns(['project_ID'])
            );

            // If parent found, inherit the project_ID
            if (parentTask && parentTask.project_ID) {
                req.data.project_ID = parentTask.project_ID;
            }
        }
    });
});