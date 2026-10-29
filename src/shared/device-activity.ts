import type { ReceiverActivityView, ReceiverView } from './inspector';

/** Connectivity is current; usage remains tied to the last accounting snapshot. */
export function applyDeviceActivity(previous: ReceiverView | undefined, activity: ReceiverActivityView): ReceiverView {
  const totals = new Map(previous?.devices.map(device => [device.id, device.total]) ?? []);
  return { ...activity, usageRevision: previous?.usageRevision, devices: activity.devices.map(device => ({ ...device, total: totals.get(device.id) ?? null })) };
}
