sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, Fragment, Filter, FilterOperator, JSONModel) {
    "use strict";

    return Controller.extend("uiprojectmanagement.controller.View1", {

        // ============================================================
        // 1. INITIALIZATION
        // ============================================================

        onInit: function () {
            // 1. Create JSON Model (No Name = Default Model)
            // This matches the XML binding path: '/root'
            var oJSONModel = new JSONModel();
            this.getView().setModel(oJSONModel); 
            
            // 2. Load Data
            this._loadDataAndBuildTree();
            this._consoleLogDebugData();

            // 3. DEBUG: Console Log Employee Data
            this._loadEmployeesData();
        },

        onAfterRendering: function() {
            // Set Visible Horizon (Zoom level) for the Gantt Chart
            var oGantt = this.byId("ganttChart");
            if (oGantt && oGantt.setVisibleStart) {
                // Adjust these dates to match your data range
                oGantt.setVisibleStart(new Date("2024-01-01T00:00:00"));
                oGantt.setVisibleEnd(new Date("2025-01-01T00:00:00"));
            }
        },

        // ============================================================
        // 2. DATA LOADING & CONVERSION
        // ============================================================

        _loadDataAndBuildTree: function() {
            var oODataModel = this.getOwnerComponent().getModel();
            var oListBinding = oODataModel.bindList("/HierarchyNodes");

            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var aFlatData = aContexts.map(function(oContext) {
                    return oContext.getObject();
                });
                
                // Convert Date Strings to Objects (REQUIRED for Gantt)
                aFlatData.forEach(function(oNode) {
                    if (oNode.startDate) oNode.startDate = new Date(oNode.startDate);
                    if (oNode.endDate) oNode.endDate = new Date(oNode.endDate);
                });

                // Build 2-Level Tree
                var aTree = this._buildFlatProjectTree(aFlatData);
                
                // Set data to the Default Model (No name string passed here)
                this.getView().getModel().setData({ root: aTree });

                console.log("Tree Data Loaded:", aTree);

            }.bind(this)).catch(function(oError) {
                console.error("Failed to load data:", oError);
                MessageToast.show("Error loading data.");
            });
        },

        /**
         * NEW LOGIC: Groups all tasks directly under their Project ID.
         * Ignores 'parent_ID' to ensure tasks are not nested inside other tasks.
         */
        _buildFlatProjectTree: function (flatList) {
            var projectsMap = {};
            var roots = [];

            // Pass 1: Identify and create Project nodes (Roots)
            flatList.forEach(function(node) {
                if (node.type === 'Project') {
                    // Initialize empty children array for tasks
                    node.children = [];
                    // Store reference in map for quick lookup
                    projectsMap[node.ID] = node;
                    roots.push(node);
                }
            });

            // Pass 2: Assign ALL Tasks directly to their Project
            flatList.forEach(function(node) {
                if (node.type === 'Task') {
                    // Find the project this task belongs to
                    var parentProject = projectsMap[node.project_ID];
                    
                    if (parentProject) {
                        // Add task directly to the Project's children
                        parentProject.children.push(node);
                    } else {
                        console.warn("Orphan Task found (No matching Project):", node.title);
                    }
                }
            });

            return roots;
        },

        // ============================================================
        // 3. DEBUG & UTILITIES
        // ============================================================

        _consoleLogDebugData: function() {
            var oODataModel = this.getOwnerComponent().getModel();
            var oProjBinding = oODataModel.bindList("/Projects");
            oProjBinding.requestContexts(0, 10).then(function(aContexts) {
                console.log("Raw Projects:", aContexts.map(c => c.getObject()));
            });
        },

        _isWeekend: function(dDate) {
            var day = dDate.getDay();
            return (day === 6 || day === 0);
        },

        _snapToNextWorkDay: function(dDate) {
            var oSnapDate = new Date(dDate);
            var daysToAdd = (oSnapDate.getDay() === 6) ? 2 : 1;
            oSnapDate.setDate(oSnapDate.getDate() + daysToAdd);
            oSnapDate.setHours(9, 0, 0, 0);
            return oSnapDate;
        },

        // ============================================================
        // 4. EVENT HANDLERS
        // ============================================================

        onShapeDrop: function (oEvent) {
            var oModel = this.getOwnerComponent().getModel();
            var oNewStartTime = oEvent.getParameter("newTime");
            var oBindingContext = oEvent.getParameter("lastDraggedShapeContext");
            var oDataObject = oBindingContext.getObject();

            if (!oDataObject || !oNewStartTime) return;

            // Snap Logic
            if (this._isWeekend(oNewStartTime)) {
                oNewStartTime = this._snapToNextWorkDay(oNewStartTime);
                MessageToast.show("Snapped to Monday.");
            }

            // Calculate new End Time
            var iDurationMs = new Date(oDataObject.endDate).getTime() - new Date(oDataObject.startDate).getTime();
            var oNewEndTime = new Date(oNewStartTime.getTime() + iDurationMs);

            // Update JSON Model (UI) immediately
            var sPath = oBindingContext.getPath();
            oBindingContext.getModel().setProperty(sPath + "/startDate", oNewStartTime);
            oBindingContext.getModel().setProperty(sPath + "/endDate", oNewEndTime);

            // Update Backend (OData V4)
            var sEntityPath = (oDataObject.type === 'Project' ? "/Projects" : "/Tasks") + "(" + oDataObject.ID + ")";
            var oContext = oModel.bindContext(sEntityPath).getBoundContext();
            
            oContext.requestObject().then(function() {
                oContext.setProperty("startDate", oNewStartTime);
                oContext.setProperty("endDate", oNewEndTime);
                MessageToast.show("Schedule updated.");
            }).catch(function() {
                MessageToast.show("Update failed.");
            });
        },

        // Zoom Handlers
        onZoomIn: function() { this.byId("ganttChart").zoomIn(); },
        onZoomOut: function() { this.byId("ganttChart").zoomOut(); },

        // Resource Allocation Handlers
        // 1. Formatter for the Heatmap (Green/Yellow/Red)
        formatter: {
            availabilityState: function(capacity) {
                if (capacity >= 8) return "Success"; // Green (Fully Available)
                if (capacity >= 4) return "Warning"; // Yellow (Partial)
                return "Error";   // Red (Overbooked)
            },
            availabilityText: function(capacity) {
                if (capacity >= 8) return "Available (8h)";
                if (capacity >= 4) return "Partially Booked";
                return "Overbooked (0h)";
            },
            availabilityIcon: function(capacity) {
                return capacity >= 8 ? "sap-icon://accept" : "sap-icon://alert";
            }
        },

        // 2. Open Dialog
        onOpenResourceFinder: function() {
            var oView = this.getView();
            var oGanttTable = this.byId("TreeTable");
            
            // 1. Check if a row is selected in the Gantt Chart
            var aSelectedIndices = oGanttTable.getSelectedIndices();
            if (aSelectedIndices.length === 0) {
                MessageToast.show("Please select a Task in the timeline first.");
                return;
            }

            // 2. Get the selected object
            var oContext = oGanttTable.getContextByIndex(aSelectedIndices[0]);
            var oSelectedNode = oContext.getObject();

            // 3. Validate: Resources can only be assigned to 'Tasks', not 'Projects'
            if (oSelectedNode.type === "Project") {
                MessageToast.show("You cannot assign resources to a Project header. Please expand and select a specific Task.");
                return;
            }

            // 4. Store the selected task for later use (when clicking 'Assign' in the dialog)
            this._oSelectedTask = oSelectedNode;

            // 5. Load and Open the Dialog
            if (!this._pResourceDialog) {
                this._pResourceDialog = Fragment.load({
                    id: oView.getId(),
                    name: "uiprojectmanagement.view.ResourceFinder",
                    controller: this
                }).then(function(oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pResourceDialog.then(function(oDialog) {
                oDialog.open();
            });
        },

        // 3. Search Filter (Skill)
        onSearchResources: function() {
            var sQuery = this.byId("skillFilter").getValue();
            var oTable = this.byId("employeeTable");
            var oBinding = oTable.getBinding("items");
            
            if (sQuery) {
                var oFilter = new Filter("jobTitle", FilterOperator.Contains, sQuery);
                oBinding.filter([oFilter]);
            } else {
                oBinding.filter([]);
            }
        },

        // 4. Assign Logic
        onAssignEmployee: function() {
            var oEmployeeTable = this.byId("employeeTable");
            var oSelectedItem = oEmployeeTable.getSelectedItem();

            // 1. Check if an Employee is selected
            if (!oSelectedItem) {
                MessageToast.show("Please select an employee from the list.");
                return;
            }

            // Fix: Pass "staff" because that is the name of the model used in the Dialog
            var oEmployee = oSelectedItem.getBindingContext("staff").getObject();
            var oTask = this._oSelectedTask; // Retrieved from the previous step

            // 2. Prepare the OData Model
            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/TaskAllocations");

            // 3. Create the Record (REAL DATABASE WRITE)
            // Note: assignedHours defaults to 8, status defaults to 'Proposed'
            try {
                oListBinding.create({
                    task_ID: oTask.ID,
                    employee_ID: oEmployee.ID,
                    assignedHours: 8,
                    startDate: oTask.startDate, // Auto-fill start date from Task
                    endDate: oTask.endDate,     // Auto-fill end date from Task
                    status: "Proposed"
                });

                // 4. Success Handling
                // In OData V4, the batch is sent automatically. We assume success if no error is thrown immediately.
                MessageToast.show("Resource " + oEmployee.firstName + " assigned to " + oTask.title);
                this.onCloseResourceFinder();

                // Optional: Clear selection
                oEmployeeTable.removeSelections(true);

            } catch (error) {
                console.error("Assignment Failed:", error);
                MessageToast.show("Failed to assign resource.");
            }
        },

        // 5. Close Dialog
        onCloseResourceFinder: function() {
            this._pResourceDialog.then(function(oDialog) {
                oDialog.close();
            });
        },

        // --- NEW DEBUG FUNCTION ---
        _loadEmployeesData: function() {
            var oODataModel = this.getOwnerComponent().getModel();
            
            // FIX: Explicitly request the specific columns we need using $select
            // This ensures the OData service returns the actual business data, not just IDs.
            var oListBinding = oODataModel.bindList("/Employees", undefined, undefined, undefined, {
                $select: "ID,firstName,lastName,email,jobTitle,dailyCapacity"
            });

            oListBinding.requestContexts(0, 100).then(function (aContexts) {
                var aData = aContexts.map(function(oContext) {
                    return oContext.getObject();
                });
                
                var oEmployeeModel = new JSONModel(aData);
                this.getView().setModel(oEmployeeModel, "staff");

                console.log("✅ Employee Data (Full):", aData);

            }.bind(this)).catch(function(oError) {
                console.error("Failed to load employees:", oError);
            });
        },
    });
});