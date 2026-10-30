export interface InkInputPoint {id?:number;x:number;y:number;time:number;force?:number;azimuth?:number;altitude?:number;expectedProperties?:number;estimationIndex?:number;updatesTimedOut?:boolean}
export interface InkInputConfiguration {width?:number;creationZoom?:number;mode?:0|1|2;fitTolerance?:number;flattenTolerance?:number;positionWindow?:number;jitterWindow?:number;forceBackward?:number;forceForward?:number;forceTime?:number;minimumFraction?:number;maximumFraction?:number;curveBlend?:number;estimateTimeout?:number}
export interface InkInputSnapshot {actualCount:number;predictedCount:number;curveCount:number;finalizedCurves:number;firstChangedCurve:number;sampleCount:number;fragmentCount:number;finished:boolean;filteredPoints:number;fitEvaluations:number;generation:number}
export interface InkInputCurve {points:number[];firstRaw:number;lastRaw:number;sampleOffset:number;steps:number;containsPredictions:boolean}
export interface InkInputStrokeSegment {points:[number,number][];radius:[number,number];firstRaw:number;lastRaw:number;containsPredictions:boolean}
export function inkInputConfiguration(options?:InkInputConfiguration):Required<InkInputConfiguration>&{version:number};
export class CompiledInkInput {
 constructor(options?:InkInputConfiguration,initialCapacity?:number);
 readonly config:Required<InkInputConfiguration>&{version:number};
 push(actual:InkInputPoint[],predicted?:InkInputPoint[]):InkInputSnapshot;
 correct(point:InkInputPoint):InkInputSnapshot;
 finish():InkInputSnapshot;
 snapshot():InkInputSnapshot;
 raw(start?:number,count?:number):Required<InkInputPoint>[];
 curves(start?:number,count?:number):InkInputCurve[];
 sampleBytes(start?:number,count?:number):Uint8Array;
 samples(start?:number,count?:number):number[][];
 filtered(start?:number,count?:number):number[][];
 strokeSegmentCount():number;
 strokeSegments(start?:number,count?:number):InkInputStrokeSegment[];
 fragmentRanges():{start:number;count:number}[];
 durableSource(sourceID:string,options?:{origin?:{x:number;y:number};opacity?:number}):unknown;
}
