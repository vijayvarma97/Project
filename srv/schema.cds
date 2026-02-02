using my.employeehub as db from '../db/schema';

service ProjectService {
    @cds.redirection.target
    entity Tasks as projection on db.Tasks;
    entity Projects as projection on db.Projects;

    // --- ADD THESE LINES ---
    // Expose Employees so the Resource Dialog can list them
    entity Employees as projection on db.Employees;

    // Expose TaskAllocations so the "Assign" button can save data
    entity TaskAllocations as projection on db.TaskAllocations;
    // -----------------------

    // Expose the fixed Hierarchy View
    entity HierarchyNodes as projection on db.HierarchyNodes;

    // Define the Recursive Hierarchy for OData V4
    annotate HierarchyNodes with @(
        Aggregation.RecursiveHierarchy #Hierarchy: {
            NodeProperty: ID,
            ParentNodeProperty: parent_ID
        }
    );
}