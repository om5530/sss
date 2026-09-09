import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BakeryMaterial,
  BakeryRecipe,
  ScaledRecipeResult,
  MultiProductResult,
  BakeryWaste,
  CostingSheet,
} from '../models/bakery.model';

@Injectable({
  providedIn: 'root',
})
export class BakeryService {
  private http = inject(HttpClient);
  private base = '/api/admin/bakery';

  // Materials
  getMaterials(params?: { type?: string; category?: string; search?: string }): Observable<{
    success: boolean;
    count: number;
    materials: BakeryMaterial[];
  }> {
    let p = new HttpParams();
    if (params?.type) p = p.set('type', params.type);
    if (params?.category) p = p.set('category', params.category);
    if (params?.search) p = p.set('search', params.search);
    return this.http.get<{ success: boolean; count: number; materials: BakeryMaterial[] }>(`${this.base}/materials`, {
      params: p,
    });
  }

  createMaterial(data: Partial<BakeryMaterial>): Observable<{ success: boolean; material: BakeryMaterial }> {
    return this.http.post<{ success: boolean; material: BakeryMaterial }>(`${this.base}/materials`, data);
  }

  updateMaterial(id: string, data: Partial<BakeryMaterial>): Observable<{ success: boolean; material: BakeryMaterial }> {
    return this.http.patch<{ success: boolean; material: BakeryMaterial }>(`${this.base}/materials/${id}`, data);
  }

  deleteMaterial(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.base}/materials/${id}`);
  }

  // Recipes
  getRecipes(params?: { category?: string; search?: string }): Observable<{
    success: boolean;
    count: number;
    recipes: BakeryRecipe[];
  }> {
    let p = new HttpParams();
    if (params?.category) p = p.set('category', params.category);
    if (params?.search) p = p.set('search', params.search);
    return this.http.get<{ success: boolean; count: number; recipes: BakeryRecipe[] }>(`${this.base}/recipes`, {
      params: p,
    });
  }

  getRecipe(id: string): Observable<{ success: boolean; recipe: BakeryRecipe }> {
    return this.http.get<{ success: boolean; recipe: BakeryRecipe }>(`${this.base}/recipes/${id}`);
  }

  createRecipe(data: Partial<BakeryRecipe>): Observable<{ success: boolean; recipe: BakeryRecipe }> {
    return this.http.post<{ success: boolean; recipe: BakeryRecipe }>(`${this.base}/recipes`, data);
  }

  updateRecipe(id: string, data: Partial<BakeryRecipe>): Observable<{ success: boolean; recipe: BakeryRecipe }> {
    return this.http.patch<{ success: boolean; recipe: BakeryRecipe }>(`${this.base}/recipes/${id}`, data);
  }

  deleteRecipe(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.base}/recipes/${id}`);
  }

  // Simulation & Calculation
  simulateRecipe(
    recipeId: string,
    quantity: number,
    targetMarkup?: number,
  ): Observable<{ success: boolean; scaled: ScaledRecipeResult }> {
    return this.http.post<{ success: boolean; scaled: ScaledRecipeResult }>(`${this.base}/simulate/recipe`, {
      recipeId,
      quantity,
      targetMarkup,
    });
  }

  simulateMulti(
    items: { recipeId: string; quantity: number }[],
    targetMarkup?: number,
  ): Observable<{ success: boolean; aggregated: MultiProductResult }> {
    return this.http.post<{ success: boolean; aggregated: MultiProductResult }>(`${this.base}/simulate/multi`, {
      items,
      targetMarkup,
    });
  }

  // Costing sheets
  getCostingSheets(type?: string): Observable<{ success: boolean; count: number; sheets: CostingSheet[] }> {
    let p = new HttpParams();
    if (type) p = p.set('type', type);
    return this.http.get<{ success: boolean; count: number; sheets: CostingSheet[] }>(`${this.base}/costing-sheets`, {
      params: p,
    });
  }

  saveCostingSheet(data: Partial<CostingSheet>): Observable<{ success: boolean; sheet: CostingSheet }> {
    return this.http.post<{ success: boolean; sheet: CostingSheet }>(`${this.base}/costing-sheets`, data);
  }

  // Inventory
  getInventory(): Observable<{
    success: boolean;
    count: number;
    materials: BakeryMaterial[];
    lowStockCount: number;
    lowStock: BakeryMaterial[];
  }> {
    return this.http.get<{
      success: boolean;
      count: number;
      materials: BakeryMaterial[];
      lowStockCount: number;
      lowStock: BakeryMaterial[];
    }>(`${this.base}/inventory`);
  }

  updateStock(id: string, currentStock: number): Observable<{ success: boolean; material: BakeryMaterial }> {
    return this.http.patch<{ success: boolean; material: BakeryMaterial }>(`${this.base}/inventory/${id}/stock`, {
      currentStock,
    });
  }

  // Waste
  getWaste(): Observable<{
    success: boolean;
    count: number;
    todayCost: number;
    monthCost: number;
    logs: BakeryWaste[];
  }> {
    return this.http.get<{
      success: boolean;
      count: number;
      todayCost: number;
      monthCost: number;
      logs: BakeryWaste[];
    }>(`${this.base}/waste`);
  }

  logWaste(data: {
    materialId?: string;
    materialName?: string;
    quantity: number;
    uom?: string;
    unitCost?: number;
    reason?: string;
    notes?: string;
  }): Observable<{ success: boolean; waste: BakeryWaste }> {
    return this.http.post<{ success: boolean; waste: BakeryWaste }>(`${this.base}/waste`, data);
  }
}
