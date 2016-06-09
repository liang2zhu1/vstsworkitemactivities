import Q = require("q");
import * as VSSService from "VSS/Service";
import * as Utils_Core from "VSS/Utils/Core";
import * as Utils_String from "VSS/Utils/String";
import {IWorkItemFormService, WorkItemFormService} from "TFS/WorkItemTracking/Services";
import * as WitClient from "TFS/WorkItemTracking/RestClient"
import * as WitContracts  from "TFS/WorkItemTracking/Contracts";
import * as WitExtensionContracts  from "TFS/WorkItemTracking/ExtensionContracts";
import * as Models from "scripts/Models";

var observerProvider = () => {

    var _visitDelegate =
        (visitedId) => {
            if (visitedId > 0) {
                WorkItemFormService.getService().then(
                    // casting to any for now since the typescript doesn't treat the calls as promises
                    (workItemFormService: IWorkItemFormService) => {
                        workItemFormService.getId().then((currentId: number) => {
                            // Only log the visit if we're still on this work item.  If they
                            // didn't look for too long, it shouldn't be considered as a visit.
                            if (visitedId == currentId) {
                                manager.addActivity(visitedId, Models.ActivityType.Visit);
                            }
                        });
                    });
            }
        };

    return {
        // Called when a new work item is being loaded in the UI
        onLoaded: (args: WitExtensionContracts.IWorkItemLoadedArgs) => {
            if (args && !args.isNew) {
                console.log(`onloaded:${args.id}`);
                Utils_Core.delay(this, 3000, _visitDelegate, [args.id])
            }
        },

        // Called after the work item has been saved
        onSaved: (args: WitExtensionContracts.IWorkItemChangedArgs) => {
            console.log(`onsaved:${args.id}`);
            if (args && args.id > 0) {
                WorkItemFormService.getService().then(
                    // casting to any for now since the typescript doesn't treat the calls as promises
                    (workItemFormService: IWorkItemFormService) => {
                        workItemFormService.getFieldValues(["System.Id", "System.Rev"]).then((values: IDictionaryStringTo<Object>) => {
                            console.log(`onsaved resolved:${args.id}, id: ${values["System.Id"]}, revision ${values["System.Rev"]}`);
                            if (args.id == <number>values["System.Id"]) {
                                manager.addActivity(args.id, Models.ActivityType.Edit, <number>values["System.Rev"]);
                            }
                        })
                    });
            }
        },
    }
};

VSS.register(VSS.getContribution().id, observerProvider);

export class ActivityManager {
    constructor() {
    }

    public addActivity(id: number, activityType: Models.ActivityType, revision?: number): IPromise<void> {
        console.log(`${Models.ActivityType[activityType]} work item ${id}`);
        var defer = Q.defer<void>();

        this._beginGetActivities().then((activities) => {
            if (!activities) {
                activities = [];
            }

            this._mergeActivities(id, activityType, revision, activities);
            defer.resolve(null);
        }, () => {
            // This happens on first time get the document
            var activities: Models.WorkItemActivityInfo[] = [];

            this._mergeActivities(id, activityType, revision, activities);
            defer.resolve(null);
        });

        return defer.promise;
    }

    public getWorkItemActivities(): IPromise<Models.WorkItemActivity[]> {
        var defer = Q.defer<Models.WorkItemActivity[]>();
        var fields: string[] = ["System.Title", "System.Id", "System.AssignedTo", "System.WorkItemType"]

        var workItemActivities: Models.WorkItemActivity[] = [];
        this._beginGetActivities().then((activities) => {
            if (activities && activities.length > 0) {
                var workItemIds: number[] = [];
                var activityMap: IDictionaryNumberTo<WitContracts.WorkItem> = {};

                $.each(activities, (i, activity) => {
                    if (activity.id > 0) {
                        workItemIds.push(activity.id);
                        activityMap[activity.id] = null;
                    }
                    else {
                        console.error(`Invalid work item id:${activity.id}}`);
                    }
                });

                WitClient.getClient().getWorkItems(workItemIds, fields).then((workItems: WitContracts.WorkItem[]) => {
                    $.each(workItems, (i, workItem) => {
                        activityMap[workItem.id] = workItem;
                    });

                    $.each(activities, (i, activity) => {
                        var workItem = activityMap[activity.id];
                        if (workItem) {
                            var workItemActivity: Models.WorkItemActivity = new Models.WorkItemActivity();
                            workItemActivity.activityType = activity.activityType;
                            workItemActivity.assignedTo = IdentityHelper.parseIdentity(workItem.fields["System.AssignedTo"]);
                            workItemActivity.date = new Date(activity.activityDate);
                            workItemActivity.id = activity.id;
                            workItemActivity.revision = activity.revision;
                            workItemActivity.title = workItem.fields["System.Title"];
                            workItemActivity.type = workItem.fields["System.WorkItemType"];
                            workItemActivity.color = TypeColorHelper.parseColor(workItemActivity.type);
                            workItemActivities.push(workItemActivity);
                        }
                    });

                    defer.resolve(workItemActivities);
                });
            }
            else {
                defer.resolve(workItemActivities);
            }
        });

        return defer.promise;
    }

    public resetWorkItemActivities(): IPromise<void> {
        var defer = Q.defer<void>();
        var activities: Models.WorkItemActivityInfo[] = [];

        VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData).then((dataService: IExtensionDataService) => {
            dataService.setValue<Models.WorkItemActivityInfo[]>(Models.Constants.StorageKey, activities, Models.Constants.UserScope);
            defer.resolve(null);
        });

        return defer.promise;
    }

    private _beginGetActivities(): IPromise<Models.WorkItemActivityInfo[]> {
        var defer = Q.defer();

        VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData).then((dataService: IExtensionDataService) => {
            dataService.getValue<Models.WorkItemActivityInfo[]>(Models.Constants.StorageKey, Models.Constants.UserScope).then((activities) => {
                defer.resolve(activities);
            }, (reason) => {
                console.error(`Unable to get activities: ${reason}`);
            });
        });

        return defer.promise;
    }

    private _mergeActivities(id: number, activityType: Models.ActivityType, revision: number, activities: Models.WorkItemActivityInfo[]): void {
        var activityDate = new Date();
        var activity = new Models.WorkItemActivityInfo();
        activity.id = id;
        // toJSON correctly formats a date string for json serialization/deserialization
        activity.activityDate = activityDate.toJSON();
        activity.activityType = activityType;
        if (revision > 0) {
            activity.revision = revision;
        }

        var existingEntry: Models.WorkItemActivityInfo;
        var existingEntryIndex: number;
        $.each(activities, (i: number, currentActivity: Models.WorkItemActivityInfo) => {
            if (currentActivity.id === activity.id) {
                existingEntryIndex = i;
                existingEntry = currentActivity;
                return false;
            }
        });

        // HACK - there is a bug where the onload event will come before the onsave event
        // in the case where it's the first time the form is loaded and you save before
        // the load is complete.
        if (existingEntry &&
            activity.activityType == Models.ActivityType.Visit &&
            existingEntry.activityType == Models.ActivityType.Edit) {
            var existingDate = new Date(existingEntry.activityDate);
            if (activityDate.getTime() - existingDate.getTime() < 10000) {
                console.log("Onload before save event");
                return;
            }
        }

        if (existingEntry) {
            // remove the entry from it's current location
            // since we're going to bring to the top of the list.
            activities.splice(existingEntryIndex, 1);
        }

        // put the activity on the top of the array
        activities.unshift(activity);

        // trim activities to a max of 1000
        activities.splice(1000);
        
        VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData).then((dataService: IExtensionDataService) => {
            dataService.setValue<Models.WorkItemActivityInfo[]>(Models.Constants.StorageKey, activities, Models.Constants.UserScope);
        });
    }

    private _beginGetHistoryById(id: number, revisionNumber: number): IPromise<WitContracts.WorkItem> {
        return WitClient.getClient().getRevision(id, revisionNumber);
    }
}

class IdentityHelper {
    private static IDENTITY_UNIQUEFIEDNAME_SEPERATOR_START = "<";
    private static IDENTITY_UNIQUEFIEDNAME_SEPERATOR_END = ">";
    private static AAD_IDENTITY_UNIQUEFIEDNAME_SEPERATOR_START = "<<";
    private static AAD_IDENTITY_UNIQUEFIEDNAME_SEPERATOR_END = ">>";
    private static TFS_GROUP_PREFIX = "id:";
    private static AAD_IDENTITY_USER_PREFIX = "user:";
    private static AAD_IDENTITY_GROUP_PREFIX = "group:";
    private static IDENTITY_UNIQUENAME_SEPARATOR = "\\";

    public static parseIdentity(identityValue: string): Models.IdentityReference {
        if (!identityValue) { return null; }

        var i = identityValue.lastIndexOf(IdentityHelper.IDENTITY_UNIQUEFIEDNAME_SEPERATOR_START);
        var j = identityValue.lastIndexOf(IdentityHelper.IDENTITY_UNIQUEFIEDNAME_SEPERATOR_END);
        var name = identityValue;
        var displayName = name;
        var alias = "";
        var rightPart = "";
        var id = "";
        if (i >= 0 && j > i) {
            displayName = $.trim(name.substr(0, i));
            rightPart = $.trim(name.substr(i + 1, j - i - 1)); //gets string in the <>
            var vsIdFromAlias: string = IdentityHelper.getVsIdFromGroupUniqueName(rightPart); // if it has vsid in unique name (for TFS groups)

            if (rightPart.indexOf("@") !== -1 || rightPart.indexOf("\\") !== -1 || vsIdFromAlias) {
                // if its a valid alias
                alias = rightPart;

                // If the alias component is just a guid then this is not a uniqueName but
                // vsId which is used only for TFS groups
                if (vsIdFromAlias != "") {
                    id = vsIdFromAlias;
                    alias = "";
                }
            }
            else {
                // if its not a valid alias, treat it as a non-identity string
                displayName = identityValue;
            }
        }

        return {
            id: id,
            displayName: displayName,
            uniqueName: alias,
            isIdentity: displayName != identityValue
        };
    }

    // Given a group uniquename that looks like id:2465ce16-6260-47a2-bdff-5fe4bc912c04\Build Administrators or id:2465ce16-6260-47a2-bdff-5fe4bc912c04, it will get the tfid from unique name
    private static getVsIdFromGroupUniqueName(str: string): string {
        var leftPart: string;
        if (!str) { return ""; }

        var vsid = "";
        var i = str.lastIndexOf(IdentityHelper.IDENTITY_UNIQUENAME_SEPARATOR);
        if (i === -1) {
            leftPart = str;
        }
        else {
            leftPart = str.substr(0, i);
        }

        if (Utils_String.startsWith(leftPart, IdentityHelper.TFS_GROUP_PREFIX)) {
            var rightPart = $.trim(leftPart.substr(3));
            vsid = Utils_String.isGuid(rightPart) ? rightPart : "";
        }

        return vsid;
    }
}

export class TypeColorHelper {
    private static _workItemTypeColors: IDictionaryStringTo<string> = {
        "Bug": "#CC293D",
        "Task": "#F2CB1D",
        "Requirement": "#009CCC",
        "Feature": "#773B93",
        "Epic": "#FF7B00",
        "User Story": "#009CCC",
        "Product Backlog Item": "#009CCC"
    };

    public static parseColor(type: string) {
        if (TypeColorHelper._workItemTypeColors[type]) {
            return TypeColorHelper._workItemTypeColors[type];
        }
        else {
            return "#FF9D00";
        }
    }
}

export var manager = new ActivityManager();
