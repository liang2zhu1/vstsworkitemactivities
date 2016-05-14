import Q = require("q");
import VSS_Service = require("VSS/Service");
import * as Utils_Core from "VSS/Utils/Core";
import {BaseControl} from "VSS/Controls";
import {StatusIndicator} from "VSS/Controls/StatusIndicator";
import {CollapsiblePanel} from "VSS/Controls/Panels";
import * as WitClient from "TFS/WorkItemTracking/RestClient";
import {WorkItemUpdate} from "TFS/WorkItemTracking/Contracts";
import {WorkItemFormNavigationService} from "TFS/WorkItemTracking/Services";
import {WorkItemActivity, ActivityType, WorkItemActivityInfo, IdentityReference, Constants} from "scripts/Models";
import {TypeColorHelper, manager} from "scripts/observer"

export class Activities extends BaseControl {
    private _activitiesContainer: JQuery;

    public initialize(): void {
        super.initialize();

        // Initialize elements
        this._activitiesContainer = $("<div/>").addClass("activities-container").appendTo(this.getElement());
    }

    /*
    * Renders activities
    *
    */
    public render(activities: WorkItemActivity[]): void {
        this._activitiesContainer.empty();

        if (activities && activities.length > 0) {
            // Render filtered activities
            activities.forEach((activity: WorkItemActivity) => {
                var activityPanel = (<CollapsiblePanel>BaseControl.createIn(CollapsiblePanel, this._activitiesContainer, { collapsed: true }))
                    .appendHeader(this._createActivityHeader(activity))
                    .appendContent(() => (this._createActivityDetails(activity)));

                if (activity.activityType != ActivityType.Edit) {
                    activityPanel.setDisabled(true);
                }
            });
        }
        else {
            $("<span />").addClass("activity").text("No activity").appendTo(this._activitiesContainer);
        }
    }

    private _createActivityHeader(activity: WorkItemActivity): JQuery {
        var $result = $("<span/>").addClass("activity");

        // Color
        $("<span/>").addClass("activity-workitem-color").attr("style", `border-color: ${activity.color}`).appendTo($result);

        // Image/Person
        $result.append(this._createIdentityElement(activity.assignedTo));

        // Type
        $result.attr("title", activity.type)

        // Id
        $("<span/>").addClass("activity-workitem-id").text(activity.id).appendTo($result);

        // Title-link
        var $link = $("<a>").appendTo($result).click({ id: activity.id }, (eventObject: JQueryEventObject) => {
            WorkItemFormNavigationService.getService().then((workItemNavSvc) => {
                // if control is pressed, open the work item in a new tab
                workItemNavSvc.openWorkItem(eventObject.data.id, eventObject.ctrlKey);
            });
            eventObject.stopPropagation();
        });

        // Title
        $("<span/>").addClass("activity-workitem-title").text(activity.title).appendTo($link);

        // Activity type
        var activityType: string;
        switch (activity.activityType) {
            case ActivityType.Visit:
                activityType = "visited";
                break;
            default:
                activityType = "edited";
                break;
        }
        $("<span/>").addClass("activity-type").text(activityType).appendTo($result);

        // Activity date
        $("<span/>").addClass("activity-date").text(`(${activity.date.toLocaleString()})`).appendTo($result);

        return $result;
    }

    private _createActivityDetails(activity: WorkItemActivity): JQuery {
        console.log(`creating details for work item  ${activity.id}`);
        var details = $("<div />");

        this._getWorkItemUpdate(activity.id, activity.revision).then((workItemUpdate) => {
            var createHeaderRow = () => {
                var $result = $("<tr/>");
                $("<td/>").text("Field").appendTo($result);
                $("<td/>").text("New Value").appendTo($result);
                if (activity.revision > 1) {
                    $("<td/>").text("Old Value").appendTo($result);
                }
                return $result;
            }

            var createRow = (field: string, fieldUpdate: any) => {
                var $result = $("<tr/>");
                $("<td/>").text(field).appendTo($result);
                var newValue = fieldUpdate.newValue;
                var oldValue = fieldUpdate.oldValue;

                // attempt to prettify the date fields

                if (Constants.UtcRegex.test(newValue)) {
                    newValue = (new Date(newValue)).toLocaleString();
                }
                if (Constants.UtcRegex.test(oldValue)) {
                    oldValue = (new Date(oldValue)).toLocaleString();
                }

                $("<td/>").appendTo($result).attr("title", newValue).text(newValue);
                if (activity.revision > 0) {
                    $("<td/>").appendTo($result).attr("title", oldValue).text(oldValue);
                }
                return $result;
            }

            var $table = $("<table/>").addClass("detail-list").append(createHeaderRow());

            for (var field in workItemUpdate.fields) {
                if (!this._isIgnoredFiled(field)) {
                    var fieldUpdate = workItemUpdate.fields[field];
                    $table.append(createRow(field, fieldUpdate));
                }
            }

            details.append($table);
        });

        return details;
    }

    private _isIgnoredFiled(fieldName: String) {
        if (fieldName == 'System.AuthorizedDate' || fieldName == 'System.RevisedDate' || fieldName == 'System.Watermark') {
            return true;
        }
        else {
            return false;
        }
    }

    private _createIdentityElement(identity: IdentityReference): JQuery {
        var identityImageUrl = `${VSS.getWebContext().host.uri}/_api/_common/IdentityImage?id=`;
        if (identity && identity.isIdentity) {
            identityImageUrl = `${identityImageUrl}&identifier=${identity.uniqueName}&identifierType=0`;
        }

        var $assignedToElement = $("<span/>").addClass("activity-assigned-to");
        var $imageElement = $("<img/>").attr("src", identityImageUrl).appendTo($assignedToElement);

        if (identity) {
            $imageElement.attr("title", identity.displayName);
        }

        return $assignedToElement;
    }

    private _getWorkItemUpdate(id: number, rev: number, skip: number = 0): IPromise<WorkItemUpdate> {
        var deferred = Q.defer<WorkItemUpdate>();
        console.log(`Getting updates for work item ${id}, rev ${rev}, skipping ${skip}`);

        // Updates are not 1:1 to revisions.  This isn't 100% guaranteed
        // to get the work item update in case a work item was linked 200
        // times between revisions.  So we start at update id being the revision - 1,
        // since there is no point retrieving previous updates since there is no
        // way they can match.
        WitClient.getClient().getUpdates(id, null, skip + rev - 1).then((workItemUpdates) => {
            var filteredWorkItemUpdates = workItemUpdates.filter((update) => {
                return update.rev == rev;
            });

            if (filteredWorkItemUpdates.length > 0) {
                deferred.resolve(filteredWorkItemUpdates[0]);
            }
            else {
                this._getWorkItemUpdate(id, rev, skip + 1).then((workItemUpdate) => {
                    deferred.resolve(workItemUpdate);
                });
            }
        });

        return deferred.promise;
    }
}


export class TypesFilterControl extends BaseControl {

    private _checkboxes: JQuery[] = [];
    private _filterControlContainer: JQuery;
    private _activities: WorkItemActivity[];
    private _activitiesControl: Activities;
    private _statusIndicator: StatusIndicator;

    constructor(options?) {
        super(options);
    }

    public initialize(): void {
        super.initialize();
        this._filterControlContainer = $("<div/>").addClass("filter-container").appendTo(this.getElement().append(
            $("<div>").addClass("filter-description").text("Filter by workitem types").hide()
        ));
        this._activitiesControl = this._options.activitiesControl;
    }

    public renderWithStatusIndicator(statusIndicatorContainer: JQuery): void {

        Utils_Core.delay(this, 200, () => {
            this._statusIndicator = <StatusIndicator>BaseControl.createIn(StatusIndicator,
                statusIndicatorContainer,
                { center: true, throttleMinTime: 0, imageClass: "big-status-progress", message: "Loading recent work item activities" });
            this._statusIndicator.start();
        });

        manager.getWorkItemActivities().then(
            (activities: WorkItemActivity[]) => {
                if (this._statusIndicator) {
                    this._statusIndicator.complete();
                }
                this.render(activities);
            }
        )
    }

    public render(activities: WorkItemActivity[]) {

        if (Activities)
            this._activities = activities;
        var workItemTypes = this.getWorkItemTypes(activities);
        if (workItemTypes && workItemTypes.length > 0) {
            $(".filter-description").show();

            $.each(workItemTypes, (i, type) => {

                var wrapper: JQuery = $("<div>").addClass("filter-checkbox-wrapper").appendTo(this._filterControlContainer);

                var checkbox: JQuery = $("<input type=\"checkbox\" />")
                    .addClass("filter-checkbox")
                    .attr("name", type)
                    .attr("value", type)
                    .attr("id", type)
                    .prop("checked", true)
                    .change(() => {
                        this._filterChecked();
                    })
                    .appendTo(wrapper);

                var color = TypeColorHelper.parseColor(type);
                var colorSpan = $("<span/>").addClass("workitem-color").attr("style", `border-color: ${color}`).appendTo(wrapper);

                var label: JQuery = $("<label>").addClass("filter-checkbox-label").attr("for", type).text(type).appendTo(wrapper);

                this._checkboxes.push(checkbox);
            });
        }
        else {
            $(".filter-description").hide();
        }

        this._activitiesControl.render(this._activities);
    }

    private _filterChecked() {
        var types: string[] = [];
        $.each(this._checkboxes, (i, checkbox: JQuery) => {
            if (checkbox.is(":checked")) {
                types.push(checkbox.attr("value"));
            }
        });

        var filteredActivites = this.filterActivities(this._activities, types);

        this._activitiesControl.render(filteredActivites);
    }

    public getWorkItemTypes(activities: WorkItemActivity[]): string[] {
        var workItemTypesMap: IDictionaryStringTo<string> = {};
        var workItemTypes: string[] = [];

        if (activities) {
            $.each(activities, (i, activity) => {

                if (!workItemTypesMap[activity.type]) {
                    workItemTypesMap[activity.type] = activity.type;
                    workItemTypes.push(activity.type);
                }
            });
        }

        return workItemTypes;
    }

    public filterActivities(activities: WorkItemActivity[], filterTypes: string[]): WorkItemActivity[] {
        var filteredActivites: WorkItemActivity[] = [];

        if (activities) {
            $.each(activities, (i, activity) => {
                if (filterTypes.indexOf(activity.type) >= 0) {
                    filteredActivites.push(activity);
                }
            });
        }

        return filteredActivites;
    }
}