using my.employeehub as db from '../db/schema';

service ProjectService {
    @cds.redirection.target
    entity Tasks as projection on db.Tasks;
    entity Projects as projection on db.Projects;

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