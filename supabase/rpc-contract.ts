/** Foundation v1. Check lpa_capabilities before enabling store flows. */
export type Units = number; // integer 0..1e12, safely representable in JS
export interface Wallet { balance: Units; currency: 'LPA'; walletVersion: number; status: 'active' | 'blocked'; economyEnabled: boolean }
export interface Product { id: string; gameId: string; itemId: string; title: string; price: Units; priceVersion: number; kind: 'consumable' | 'permanent'; quantity: number }
export interface Grant { id: string; gameId: string; itemId: string; kind: 'consumable' | 'permanent'; quantity: number }
export interface Receipt { purchaseId: string; gameId: string; productId: string; priceVersion: number; status: 'purchased' | 'already_owned'; balance: Units; currency: 'LPA'; walletVersion: number; grant: Grant }
export interface Capabilities { contractVersion: 1; registry: boolean; economy: boolean; providers: false; cloudSaves: false; spendEnabled: boolean }
export interface RegisteredGame { id: string; title: string; url: string; scoreUnit: 'points' | 'milliseconds' | 'none' }
export interface RpcContract {
 lpa_wallet: { args: Record<string, never>; result: Wallet };
 lpa_catalog: { args: { p_game_id: string }; result: Product[] };
 lpa_inventory: { args: { p_game_id: string }; result: Grant[] };
 lpa_purchase: { args: { p_game_id: string; p_product_id: string; p_request_id: string; p_price_version: number }; result: Receipt };
 lpa_purchase_status: { args: { p_request_id: string }; result: Receipt | null };
 lpa_capabilities: { args: Record<string, never>; result: Capabilities };
 lpa_games: { args: Record<string, never>; result: RegisteredGame[] };
}
export type RpcError = 'authentication_required' | 'game_unavailable' | 'product_unavailable' | 'request_id_required' | 'price_quote_required' | 'price_changed' | 'economy_disabled' | 'account_blocked' | 'insufficient_funds' | 'idempotency_conflict' | 'projection_mismatch';
// Receipt balance is historical; reread wallet after accepted replay.
// Pending network/missing RPC never implies success, zero funds, or provider readiness.
