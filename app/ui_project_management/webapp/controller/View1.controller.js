sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    return Controller.extend("uiprojectmanagement.controller.View1", {
        
        onInit: function () {
            // Existing logic (if any)
        },

        onAfterRendering: function() {
            // Initialize Gantt Chart Visible Horizon
            var oGantt = this.byId("ganttChart");
            
            // Check if the control exists and has the method
            if (oGantt && oGantt.setVisibleStart) {
                oGantt.setVisibleStart(new Date("2025-02-01T00:00:00"));
                oGantt.setVisibleEnd(new Date("2026-04-01T00:00:00"));
            }
        },

        onShapeDrop: function (oEvent) {
            var oModel = this.getView().getModel();
            var oNewTime = oEvent.getParameter("newTime");
            var oBindingContext = oEvent.getParameter("lastDraggedShapeContext");

            if (!oBindingContext || !oNewTime) return;

            var oData = oBindingContext.getObject();
            
            // Safety check for valid dates
            if(!oData.startDate || !oData.endDate) return;

            var iDuration = new Date(oData.endDate).getTime() - new Date(oData.startDate).getTime();
            var oNewEndDate = new Date(oNewTime.getTime() + iDuration);

            oModel.update(oBindingContext.getPath(), {
                startDate: oNewTime,
                endDate: oNewEndDate
            }, {
                success: function () {
                    MessageToast.show("Schedule updated.");
                },
                error: function () {
                    MessageToast.show("Error updating schedule.");
                }
            });
        },

        onZoomIn: function () {
            var oGantt = this.byId("ganttChart");
            if (oGantt) {
                oGantt.zoomIn();
            }
        },

        onZoomOut: function () {
            var oGantt = this.byId("ganttChart");
            if (oGantt) {
                oGantt.zoomOut();
            }
        }
    });
});