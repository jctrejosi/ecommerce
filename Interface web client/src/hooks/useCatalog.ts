import { useEffect, useState } from "react";
import type { CatalogCategory, Product } from "../app/types";
import {
  catalogService,
  type CatalogProductsQuery,
} from "../services/catalog.service";

export function useCatalog(
  filters?: CatalogProductsQuery,
  initialCategories?: CatalogCategory[],
) {
  const [categories, setCategories] = useState<CatalogCategory[]>(
    initialCategories ?? [],
  );

  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }, [initialCategories]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categoriesKey = filters?.categories?.join("|") ?? "";
  const categoryIdsKey = filters?.categoryIds?.join("|") ?? "";
  const productIdsKey = filters?.productIds?.join("|") ?? "";

  // Load products when filters change
  useEffect(() => {
    let mounted = true;

    const loadProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await catalogService.getProducts(filters);
        if (mounted) {
          setProducts(data);
        }
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error ? err.message : "Error cargando productos",
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadProducts();

    return () => {
      mounted = false;
    };
  }, [
    categoriesKey,
    categoryIdsKey,
    productIdsKey,
    filters?.productTypeCode,
    filters?.onSale,
    filters?.priceRange,
    filters?.sort,
    filters?.search,
    filters?.brandId,
    filters?.limit,
    filters?.offset, // el scroll infinito depende del offset; sin esto se repite la página 1
  ]);

  return {
    categories,
    products,
    loading,
    error,
  };
}
