namespace my.employeehub;

using { cuid, managed } from '@sap/cds/common';

// --------------------------------------------------------------------------
// 1.1 WBS Hierarchy & Task Definition
// --------------------------------------------------------------------------

entity Projects : cuid, managed {
    title          : String(100);
    description    : String(500);
    startDate      : Date;
    endDate        : Date;
    status         : String enum { Planning; Active; Completed; OnHold };
    // Composition ensures cascading deletes (Project -> Root Tasks)
    tasks          : Composition of many Tasks on tasks.project = $self;
    team           : Composition of many ProjectTeam on team.project = $self;
}

entity Tasks : cuid, managed {
    title          : String(100);
    description    : String(500);
    
    // WBS Hierarchy Logic
    project        : Association to Projects;
    // Recursive Parent-Child relationship
    parent         : Association to Tasks; 
    // Composition ensures deleting a Parent Task deletes children
    children       : Composition of many Tasks on children.parent = $self;
    
    // Scheduling (Gantt Data)
    startDate      : DateTime;
    endDate        : DateTime;
    duration       : Integer; // stored in hours or days
    progress       : Integer default 0; // 0 to 100
    isMilestone    : Boolean default false;
    
    // Critical Path Analysis Fields (Phase 1.1)
    constraintType : String enum { MustStartOn; AsSoonAsPossible; StartNoEarlierThan };
    earlyStart     : DateTime;
    lateFinish     : DateTime;
    
    // Resource & Skills
    allocations    : Composition of many TaskAllocations on allocations.task = $self;
    requiredSkill  : String(50); // Simple string for now, can be an entity later
}

// --------------------------------------------------------------------------
// 1.2 Resource Allocation Models
// --------------------------------------------------------------------------

entity Employees : cuid, managed {
    firstName      : String(50);
    lastName       : String(50);
    email          : String(100);
    jobTitle       : String(50);
    // Simple way to track aggregate availability (e.g., 8 hours/day standard)
    dailyCapacity  : Integer default 8; 
}

entity ProjectTeam : cuid {
    project        : Association to Projects;
    employee       : Association to Employees;
    role           : String(50); // e.g., "Project Manager", "Developer"
}

entity TaskAllocations : cuid, managed {
    task           : Association to Tasks;
    employee       : Association to Employees;
    assignedHours  : Integer;
    startDate      : Date;
    endDate        : Date;
    status         : String enum { Proposed; Confirmed };
}

// --------------------------------------------------------------------------
// 1.3 Union View for UI Hierarchy (Project -> Task -> SubTask)
// --------------------------------------------------------------------------
@readonly
entity HierarchyNodes as 
    // PART 1: Projects (The Roots)
    select from Projects {
        key ID,
        null as parent_ID : UUID,
        title,
        cast(startDate as DateTime) as startDate, 
        cast(endDate as DateTime) as endDate,
        status as statusOrProgress,
        'Project' as type : String(10),
        
        // --- ADD THIS LINE ---
        false as isMilestone : Boolean, 
        // ---------------------

        ID as project_ID,
        0 as drillState : String
    }
    union all
    // PART 2: Tasks (The Children)
    select from Tasks {
        key ID,
        coalesce(parent.ID, project.ID) as parent_ID : UUID,
        title,
        startDate,
        endDate,
        cast(progress as String) as statusOrProgress,
        'Task' as type : String(10),
        
        // --- ADD THIS LINE ---
        isMilestone, 
        // ---------------------

        project.ID as project_ID,
        'expanded' as drillState : String
    };