// kpi.js
import { safeDivide, pct, avg, sum } from "./utils.js";

export function calculateKpis(records) {
  const totalUnits = sum(records, "unitsProcessed");
  const totalHours = sum(records, "hoursWorked");

  const totalReceipts = sum(records, "totalReceipts");
  const correctReceipts = sum(records, "correctReceipts");

  const totalPutaways = sum(records, "totalPutaways");
  const correctPutaways = sum(records, "correctPutaways");

  const totalPicks = sum(records, "totalPicks");
  const correctPicks = sum(records, "correctPicks");

  const shipments = sum(records, "shipments");
  const onTimeShipments = sum(records, "onTimeShipments");
  const damageFreeShipments = sum(records, "damageFreeShipments");

  const dockTimes = records.map(r => r.dockToStock).filter(n => n > 0);
  const meanShipTimes = records.map(r => r.meanTimeToShip).filter(n => n > 0);

  const inventoryCount = sum(records, "inventoryCount");
  const inventorySystemCount = sum(records, "inventorySystemCount");

  return {
    laborProductivity: safeDivide(totalUnits, totalHours),
    receivingAccuracy: pct(correctReceipts, totalReceipts),
    putawayAccuracy: pct(correctPutaways, totalPutaways),
    pickAccuracy: pct(correctPicks, totalPicks),
    onTimeShipmentRate: pct(onTimeShipments, shipments),
    damageFreeRate: pct(damageFreeShipments, shipments),

    avgDockToStock: avg(dockTimes),
    avgMeanTimeToShip: avg(meanShipTimes),

    inventoryAccuracy: inventorySystemCount > 0
      ? 100 - (Math.abs(inventorySystemCount - inventoryCount) / inventorySystemCount) * 100
      : 0
  };
}
