/** Days the production plan looks ahead: today, tomorrow and the day after. */
export const PLAN_DAYS = 3;

/** One order in the production plan, with its items (GET /api/admin/production-plan). */
export interface PlanOrder {
  id: string;
  order_number: string;
  customer_name: string;
  order_type: 'pickup' | 'delivery';
  pickup_date: string | null;
  pickup_location: string | null;
  created_at: string;
  items: Array<{ product_name: string; quantity: number; selected_tier: number | null }>;
}

export interface ProductionPlan {
  /** Pickup orders by pickup date: today, tomorrow, the day after. */
  days: Array<{ date: string; orders: PlanOrder[] }>;
  /** Delivery orders still waiting to ship (any order date). */
  delivery: PlanOrder[];
}
