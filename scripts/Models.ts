export enum ActivityType {
    Visit = 0,
    Edit = 1,
}

export class Activity {
    public activityType: ActivityType;
}

export class WorkItemActivity extends Activity {
    public id: number;
    public type: string;
    public color: string;
    public title: string;
    public date: Date;
    public assignedTo: IdentityReference;
    public revision: number;
}

export class WorkItemActivityInfo {
    public id: number;
    public activityType: ActivityType;
    public revision: number;
    public activityDate: string;
}

export class IdentityReference {
    id: string;
    displayName: string;
    uniqueName: string;
    isIdentity: boolean;
}

export class Constants {
    public static StorageKey: string = "WorkItemActivityStorage";
    public static UserScope = { scopeType: "User" };
    public static UtcRegex = /\d+-\d+-\d+T\d+:\d+:\d+\.\d+Z/;
}