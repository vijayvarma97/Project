sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",             // <--- 3. Loaded here
    "sap/ui/core/Fragment",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/DateFormat"
], function (
    Controller, 
    MessageToast, 
    MessageBox,                     // <--- 3. Assigned here (MUST MATCH)
    Fragment, 
    Filter, 
    FilterOperator, 
    JSONModel, 
    DateFormat
) {
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

            // 1. Validation
            if (!oSelectedItem) {
                sap.m.MessageToast.show("Please select an employee from the list.");
                return;
            }

            // 2. Get Data
            var oEmployee = oSelectedItem.getBindingContext("staff").getObject();
            var oTask = this._oSelectedTask; 

            // --- DATE FIX: Format to "yyyy-MM-dd" string ---
            // This prevents the "400 Bad Request" error
            var oFormat = DateFormat.getInstance({ pattern: "yyyy-MM-dd" });
            var sStartDate = oFormat.format(oTask.startDate);
            var sEndDate = oFormat.format(oTask.endDate);
            // -----------------------------------------------

            // 3. Prepare Backend Call
            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/TaskAllocations");

            try {
                // 4. Create Record
                var oContext = oListBinding.create({
                    task_ID: oTask.ID,
                    employee_ID: oEmployee.ID,
                    assignedHours: 8,
                    startDate: sStartDate, // Sending String "2026-02-03"
                    endDate: sEndDate,     // Sending String "2026-02-10"
                    status: "Proposed"
                });

                // 5. Success/Error Handling via Promise
                oContext.created().then(function() {
                    sap.m.MessageToast.show("Resource " + oEmployee.firstName + " assigned successfully.");
                    this.onCloseResourceFinder();
                    
                    // Clear selection
                    oEmployeeTable.removeSelections(true);

                }.bind(this)).catch(function(oError) {
                    // This handles the server error if something else goes wrong
                    sap.m.MessageBox.error("Assignment Failed: " + oError.message);
                });

            } catch (error) {
                console.error("Local Error:", error);
                sap.m.MessageBox.error("System Error: " + error.message);
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
        onCreateTask: function() {
            // --- FIX: Define oView here ---
            var oView = this.getView();
            // ------------------------------

            // 1. Get Selected Node
            // Use the safe way to get the table from the chart
            var oGanttChart = this.byId("ganttChart");
            var oGanttTable = oGanttChart.getTable(); 
            var aSelectedIndices = oGanttTable.getSelectedIndices();

            if (aSelectedIndices.length === 0) {
                MessageToast.show("Please select a Project or Parent Task first.");
                return;
            }

            var oContext = oGanttTable.getContextByIndex(aSelectedIndices[0]);
            var oSelectedNode = oContext.getObject();
            
            // 2. Prepare Data for the new task
            var oNewTaskData = {
                title: "",
                startDate: null,
                endDate: null,
                parent_ID: null,
                project_ID: null
            };

            // Logic: Determine Parent and Project IDs
            if (oSelectedNode.type === "Project") {
                // Adding directly to a Project (Root Task)
                oNewTaskData.project_ID = oSelectedNode.ID;
                oNewTaskData.parent_ID = null; 
            } else {
                // Adding a Sub-Task
                oNewTaskData.project_ID = oSelectedNode.project_ID;
                oNewTaskData.parent_ID = oSelectedNode.ID;
            }

            // 3. Create a temporary JSON model for the Dialog inputs
            var oTaskModel = new JSONModel(oNewTaskData);
            this.getView().setModel(oTaskModel, "newTask");

            // 4. Open Dialog
            if (!this._pCreateTaskDialog) {
                this._pCreateTaskDialog = Fragment.load({
                    id: oView.getId(), // Now oView is defined!
                    name: "uiprojectmanagement.view.CreateTask",
                    controller: this
                }).then(function(oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pCreateTaskDialog.then(function(oDialog) {
                oDialog.open();
            });
        },
        onSaveNewTask: function() {
            var oModel = this.getView().getModel("newTask");
            var oData = oModel.getData();

            if (!oData.title || !oData.startDate || !oData.endDate) {
                sap.m.MessageToast.show("Please fill all fields.");
                return;
            }

            // Convert Date Strings ("2026-02-01") to ISO DateTime for Backend
            var sISOStart = oData.startDate + "T09:00:00Z";
            var sISOEnd = oData.endDate + "T17:00:00Z";

            var oODataModel = this.getOwnerComponent().getModel();
            var oListBinding = oODataModel.bindList("/Tasks");

            try {
                var oContext = oListBinding.create({
                    title: oData.title,
                    startDate: sISOStart, 
                    endDate: sISOEnd,
                    project_ID: oData.project_ID,
                    parent_ID: oData.parent_ID,
                    // REMOVED "status": "Planning" because it doesn't exist in the DB
                    progress: 0
                });

                oContext.created().then(function() {
                    sap.m.MessageToast.show("Task created successfully!");
                    this._pCreateTaskDialog.then(function(d) { d.close(); });
                    
                    // REFRESH GANTT CHART
                    this._loadDataAndBuildTree();

                }.bind(this)).catch(function(oError) {
                    sap.m.MessageBox.error("Creation failed: " + oError.message);
                });

            } catch (e) {
                sap.m.MessageBox.error("Error: " + e.message);
            }
        },

        onCancelCreateTask: function() {
            this._pCreateTaskDialog.then(function(d) { d.close(); });
        },

        onDeleteTask: function() {
            var oView = this.getView();
            var oGanttChart = this.byId("ganttChart");
            var oGanttTable = oGanttChart.getTable();
            var aSelectedIndices = oGanttTable.getSelectedIndices();

            // 1. Validation
            if (aSelectedIndices.length === 0) {
                sap.m.MessageToast.show("Please select a task to delete.");
                return;
            }

            var oContext = oGanttTable.getContextByIndex(aSelectedIndices[0]);
            var oSelectedNode = oContext.getObject();

            if (oSelectedNode.type === "Project") {
                sap.m.MessageBox.error("You cannot delete a whole Project from here. Please select a Task.");
                return;
            }

            // 2. Confirmation & Deletion
            sap.m.MessageBox.confirm("Are you sure you want to delete '" + oSelectedNode.title + "'?", {
                onClose: function(sAction) {
                    if (sAction === "OK") {
                        
                        // --- PREPARE BACKEND OPERATION ---
                        var oODataModel = this.getOwnerComponent().getModel();
                        var sPath = "/Tasks(" + oSelectedNode.ID + ")";
                        
                        // Create a binding to the specific entity
                        var oContextBinding = oODataModel.bindContext(sPath);

                        // --- FIX: INITIALIZE & DELETE ---
                        oContextBinding.requestObject().then(function() {
                            
                            // 1. Get the actual "Bound Context" object
                            var oBoundContext = oContextBinding.getBoundContext();
                            
                            // 2. Delete using the CONTEXT object (not the binding)
                            return oBoundContext.delete();

                        }).then(function() {
                            sap.m.MessageToast.show("Task deleted successfully.");
                            
                            // 3. Refresh Gantt Chart
                            this._loadDataAndBuildTree();

                        }.bind(this)).catch(function(oError) {
                            // Robust Error Handling
                            var sMsg = oError.message || "Unknown error";
                            if (oError.response) { sMsg = "Server Error"; } 
                            sap.m.MessageBox.error("Delete failed: " + sMsg);
                        });
                    }
                }.bind(this)
            });
        },
    });
});