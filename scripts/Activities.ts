import {BaseControl} from "VSS/Controls";
import {Splitter} from "VSS/Controls/Splitter";
import * as Controls from "scripts/Controls";
import {WorkItemActivity, ActivityType, WorkItemActivityInfo} from "scripts/Models";
import * as Observer from "scripts/observer";

export class Activities {
    public initialize() {

        // Create splitter control 
        var splitterControl = BaseControl.createIn(Splitter, $(".page"), {
            cssClass: "content",
            fixedSide: "left",
            initialSize: 250,
            handleBarWidth: "5px",
            enableToggleButton: true,
            vertical: false,
            minWidth: 200
        });

        var $splitter = splitterControl.getElement();

        // Move activity body to the right pane of splitter control 
        $(".activity-body").appendTo($splitter.find(".rightPane"));

        $(".activity-body .hub-title .person").text(VSS.getWebContext().user.name);

        var activitiesControl = <Controls.Activities>BaseControl.createIn(Controls.Activities, $(".activity-body .content"));
        var typesFilterControl = <Controls.TypesFilterControl>BaseControl.createIn(Controls.TypesFilterControl, $splitter.find(".leftPane"), {
            activitiesControl: activitiesControl
        });

        $(".activity-body .hub-title .reset").click(() => {
            Observer.manager.resetWorkItemActivities().then(() => {
                activitiesControl.render([]);
            });
        });

        typesFilterControl.renderWithStatusIndicator($(".activity-body"));

        $(".hidden-onload").show();

    }
}
