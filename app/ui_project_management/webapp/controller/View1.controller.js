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
        // 1. INITIALIZATION & DATA LOADING (V4 Fixed)
        // ============================================================

        onInit: function () {
            // A. Setup local JSON Model for the Tree
            var oJSONModel = new JSONModel();
            this.getView().setModel(oJSONModel, "ganttModel");
            
            // B. Load Data using OData V4 syntax
            this._loadDataAndBuildTree();

            // C. Debug Data
            this._consoleLogDebugData();
        },

        onAfterRendering: function() {
            var oGantt = this.byId("ganttChart");
            if (oGantt && oGantt.setVisibleStart) {
                oGantt.setVisibleStart(new Date("2025-02-01T00:00:00"));
                oGantt.setVisibleEnd(new Date("2026-04-01T00:00:00"));
            }
        },

        /**
         * V4 COMPATIBLE: Load data using bindList + requestContexts
         */
        _loadDataAndBuildTree: function() {
            var oODataModel = this.getOwnerComponent().getModel();
            
            // In V4, we bind a list and request contexts instead of calling .read()
            var oListBinding = oODataModel.bindList("/HierarchyNodes");

            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                // Extract the raw object data from the V4 Contexts
                var aFlatData = aContexts.map(function(oContext) {
                    return oContext.getObject();
                });
                
                // Convert Flat List -> Tree
                var aTree = this._buildTree(aFlatData);
                
                // Bind to JSON Model
                this.getView().getModel("ganttModel").setData({ root: aTree });

                console.log("Tree Built Successfully:", aTree);

            }.bind(this)).catch(function(oError) {
                console.error("Failed to load HierarchyNodes:", oError);
                MessageToast.show("Error loading data.");
            });
        },

        /**
         * V4 COMPATIBLE: Debug Logs
         */
        _consoleLogDebugData: function() {
            var oODataModel = this.getOwnerComponent().getModel();

            // Log Projects
            var oProjBinding = oODataModel.bindList("/Projects");
            oProjBinding.requestContexts(0, 100).then(function(aContexts) {
                console.log("%c Projects Data ", "background: blue; color: white;", aContexts.map(c => c.getObject()));
            });

            // Log Tasks
            var oTaskBinding = oODataModel.bindList("/Tasks");
            oTaskBinding.requestContexts(0, 100).then(function(aContexts) {
                console.log("%c Tasks Data ", "background: green; color: white;", aContexts.map(c => c.getObject()));
            });
        },

        _buildTree: function (flatList) {
            var map = {}, node, roots = [], i;
            for (i = 0; i < flatList.length; i += 1) {
                map[flatList[i].ID] = i; 
                flatList[i].children = []; 
            }
            for (i = 0; i < flatList.length; i += 1) {
                node = flatList[i];
                if (node.parent_ID && map[node.parent_ID] !== undefined) {
                    flatList[map[node.parent_ID]].children.push(node);
                } else {
                    roots.push(node);
                }
            }
            return roots;
        },

        // ============================================================
        // 2. DRAG-AND-DROP (V4 Fixed)
        // ============================================================

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

        onShapeDrop: function (oEvent) {
            var oModel = this.getOwnerComponent().getModel();
            var oNewStartTime = oEvent.getParameter("newTime");
            var oBindingContext = oEvent.getParameter("lastDraggedShapeContext");
            var oDataObject = oBindingContext.getObject();

            if (!oDataObject || !oNewStartTime) return;

            // 1. Snapping Logic
            if (this._isWeekend(oNewStartTime)) {
                oNewStartTime = this._snapToNextWorkDay(oNewStartTime);
                MessageToast.show("Snapped to Monday.");
            }

            // 2. Calculate End Time
            var iDurationMs = new Date(oDataObject.endDate).getTime() - new Date(oDataObject.startDate).getTime();
            var oNewEndTime = new Date(oNewStartTime.getTime() + iDurationMs);

            // 3. Update UI (JSON Model) immediately
            var sPath = oBindingContext.getPath();
            oBindingContext.getModel().setProperty(sPath + "/startDate", oNewStartTime);
            oBindingContext.getModel().setProperty(sPath + "/endDate", oNewEndTime);

            // 4. Update Backend (OData V4)
            // In V4, we must bind to the specific entity context to update it
            var sEntityPath = (oDataObject.type === 'Project' ? "/Projects" : "/Tasks") + "(" + oDataObject.ID + ")";
            
            // We bind to the context, request the object to make it active, then set properties
            var oContext = oModel.bindContext(sEntityPath).getBoundContext();
            
            oContext.requestObject().then(function() {
                oContext.setProperty("startDate", oNewStartTime);
                oContext.setProperty("endDate", oNewEndTime);
                // V4 automatically batches and sends this update
                MessageToast.show("Schedule updated in backend.");
            }).catch(function(err) {
                console.error("Update failed", err);
                MessageToast.show("Update failed.");
            });
        },

        // ============================================================
        // 3. RESOURCE ALLOCATION (V4 Fixed)
        // ============================================================

        formatter: {
            availabilityState: function(c) { return c >= 8 ? "Success" : (c >= 4 ? "Warning" : "Error"); },
            availabilityText: function(c) { return c >= 8 ? "Available" : (c >= 4 ? "Partially Booked" : "Overbooked"); },
            availabilityIcon: function(c) { return c >= 8 ? "sap-icon://accept" : (c >= 4 ? "sap-icon://alert" : "sap-icon://decline"); }
        },

        onOpenResourceFinder: function() {
            var oView = this.getView();
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
            this._pResourceDialog.then(function(oDialog) { oDialog.open(); });
        },

        onSearchResources: function() {
            var sKey = this.byId("skillFilter").getValue();
            var aFilters = [];
            if (sKey) aFilters.push(new Filter("jobTitle", FilterOperator.Contains, sKey));
            
            // Note: If your employees list is also OData V4, standard filtering works the same
            var oTable = this.byId("employeeTable");
            var oBinding = oTable.getBinding("items");
            oBinding.filter(aFilters);
        },

        onAssignEmployee: function() {
            var oTable = this.byId("employeeTable");
            var oSelectedItem = oTable.getSelectedItem();

            if (!oSelectedItem) { MessageToast.show("Select an employee."); return; }
            var oEmployee = oSelectedItem.getBindingContext().getObject();
            
            var oGantt = this.byId("ganttChart");
            var aSelectedRows = oGantt.getTable().getSelectedIndices();
            if (aSelectedRows.length === 0) { MessageToast.show("Select a Task first."); return; }

            var oTask = oGantt.getTable().getContextByIndex(aSelectedRows[0]).getObject();
            if (oTask.type === "Project") { MessageToast.show("Cannot assign to Project."); return; }

            // Create Allocation (OData V4)
            var oModel = this.getOwnerComponent().getModel();
            
            // In V4, creation is done via a List Binding
            var oListBinding = oModel.bindList("/TaskAllocations");
            
            oListBinding.create({
                task_ID: oTask.ID,
                employee_ID: oEmployee.ID,
                assignedHours: 8,
                startDate: oTask.startDate,
                endDate: oTask.endDate,
                status: "Proposed"
            });

            // V4 submits automatically (or depends on batch group). 
            // If strictly needed, we can listen to the promise of the created context
            MessageToast.show("Resource " + oEmployee.firstName + " assigned!");
            this.onCloseResourceFinder();
        },

        onCloseResourceFinder: function() {
            if (this._pResourceDialog) {
                this._pResourceDialog.then(function(oDialog) { oDialog.close(); });
            }
        },

        onZoomIn: function() { this.byId("ganttChart").zoomIn(); },
        onZoomOut: function() { this.byId("ganttChart").zoomOut(); }
    });
});