/**
 * Product listing page — Server-side rendered for filtering/search.
 */

import { ChangeEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import { SearchX } from 'lucide-react';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import ProductCard from '../../components/products/ProductCard';
import { getStoreInfo, getProducts, getDepartments } from '../../lib/api';
import type { Store, Product, Department } from '../../lib/types';

interface ProductFilters {
  department: string | null;
  search: string | null;
  sort: string | null;
}

interface ProductsPageProps {
  store: Store | null;
  products: Product[];
  departments: Department[];
  total: number;
  page: number;
  pages: number;
  filters: ProductFilters;
}

export default function ProductsPage({ store, products, departments, total, page, pages, filters }: ProductsPageProps) {
  const router = useRouter();
  const storeSlugQ = router.query.store;
  const storeSlug = typeof storeSlugQ === 'string' ? storeSlugQ : 'demo';
  const sq = `store=${storeSlug}`;

  const handleDeptFilter = (deptSlug: string | null) => {
    const newDept = filters.department === deptSlug ? null : deptSlug;
    const query: Record<string, string> = { store: storeSlug };
    if (newDept) query.department = newDept;
    if (filters.search) query.search = filters.search;
    router.push({ pathname: '/products', query });
  };

  const handleSort = (e: ChangeEvent<HTMLSelectElement>) => {
    const query: Record<string, string> = { store: storeSlug };
    if (filters.department) query.department = filters.department;
    if (filters.search) query.search = filters.search;
    if (e.target.value) query.sort = e.target.value;
    router.push({ pathname: '/products', query });
  };

  return (
    <>
      <Head>
        <title>Products — {store?.storeName || store?.name || 'Store'}</title>
      </Head>

      <Header />
      <CartDrawer />

      <main className="sf-container">
        <div className="sf-page-header">
          <h1 className="sf-page-title">
            {filters.search ? `Search: "${filters.search}"` : 'Products'}
          </h1>
          <p className="sf-page-subtitle">{total} product{total !== 1 ? 's' : ''}</p>
        </div>

        <div className="sf-toolbar">
          {departments.length > 0 && (
            <div className="sf-dept-list">
              <button
                className={`sf-dept-badge ${!filters.department ? 'sf-dept-badge--active' : ''}`}
                onClick={() => handleDeptFilter(null)}
              >
                All
              </button>
              {departments.map(d => (
                <button
                  key={d.slug}
                  className={`sf-dept-badge ${filters.department === d.slug ? 'sf-dept-badge--active' : ''}`}
                  onClick={() => handleDeptFilter(d.slug ?? null)}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
          <select className="sf-sort-select" value={filters.sort || ''} onChange={handleSort}>
            <option value="">Sort: Default</option>
            <option value="name">Name A-Z</option>
            <option value="price_asc">Price: Low → High</option>
            <option value="price_desc">Price: High → Low</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {products.length > 0 ? (
          <>
            <div className="sf-product-grid">
              {products.map(p => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>

            {pages > 1 && (
              <div className="sf-pagination">
                {page > 1 && (
                  <Link href={`/products?${sq}&page=${page - 1}${filters.department ? `&department=${filters.department}` : ''}${filters.search ? `&search=${filters.search}` : ''}`} className="sf-page-btn">
                    ← Prev
                  </Link>
                )}
                <span className="sf-page-info">Page {page} of {pages}</span>
                {page < pages && (
                  <Link href={`/products?${sq}&page=${page + 1}${filters.department ? `&department=${filters.department}` : ''}${filters.search ? `&search=${filters.search}` : ''}`} className="sf-page-btn">
                    Next →
                  </Link>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="sf-empty">
            <div className="sf-empty-icon"><SearchX size={48} strokeWidth={1.5} /></div>
            <p>No products found</p>
            {(filters.search || filters.department) && (
              <Link href={`/products?${sq}`} className="sc-continue-btn sc-continue-btn--mt12">
                Clear Filters
              </Link>
            )}
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}

/** Extracts a scalar string from Next's query type (string | string[] | undefined). */
function q(v: string | string[] | undefined): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

const EMPTY_PROPS: ProductsPageProps = {
  store: null,
  products: [],
  departments: [],
  total: 0,
  page: 1,
  pages: 1,
  filters: { department: null, search: null, sort: null },
};

export async function getServerSideProps(
  ctx: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<ProductsPageProps>> {
  const { getStoreSlug } = await import('../../lib/resolveStore');
  const slug = getStoreSlug(ctx);
  if (!slug) return { props: EMPTY_PROPS };

  const { query } = ctx;
  const department = q(query.department);
  const search = q(query.search);
  const sort = q(query.sort);
  const page = q(query.page);

  try {
    const params: Record<string, string | number> = { limit: 48 };
    if (department) params.department = department;
    if (search) params.search = search;
    if (sort) params.sort = sort;
    if (page) params.page = page;

    const [store, productsResp, departments] = await Promise.all([
      getStoreInfo(slug),
      getProducts(slug, params),
      getDepartments(slug),
    ]);

    return {
      props: {
        store,
        products: productsResp.data || [],
        departments: departments || [],
        total: Number(productsResp.total) || 0,
        page: Number(productsResp.page) || 1,
        pages: Number(productsResp.pages) || 1,
        filters: {
          department: department || null,
          search: search || null,
          sort: sort || null,
        },
      },
    };
  } catch {
    return { props: EMPTY_PROPS };
  }
}
