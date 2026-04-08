/**
 * Product listing page — Server-side rendered for filtering/search.
 */

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/layout/Header';
import Footer from '../../components/layout/Footer';
import CartDrawer from '../../components/cart/CartDrawer';
import ProductCard from '../../components/products/ProductCard';
import { getStoreInfo, getProducts, getDepartments } from '../../lib/api';

export default function ProductsPage({ store, products, departments, total, page, pages, filters }) {
  const router = useRouter();
  const storeSlug = router.query.store || 'demo';
  const sq = `store=${storeSlug}`;

  const handleDeptFilter = (deptSlug) => {
    const newDept = filters.department === deptSlug ? null : deptSlug;
    const query = { store: storeSlug };
    if (newDept) query.department = newDept;
    if (filters.search) query.search = filters.search;
    router.push({ pathname: '/products', query });
  };

  const handleSort = (e) => {
    const query = { store: storeSlug };
    if (filters.department) query.department = filters.department;
    if (filters.search) query.search = filters.search;
    if (e.target.value) query.sort = e.target.value;
    router.push({ pathname: '/products', query });
  };

  return (
    <>
      <Head>
        <title>Products — {store?.storeName || 'Store'}</title>
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
                  onClick={() => handleDeptFilter(d.slug)}
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
            <div className="sf-empty-icon">🔍</div>
            <p>No products found</p>
            {(filters.search || filters.department) && (
              <Link href={`/products?${sq}`} className="sc-continue-btn" style={{ marginTop: 12 }}>
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

export async function getServerSideProps(ctx) {
  const { getStoreSlug } = await import('../../lib/resolveStore.js');
  const slug = getStoreSlug(ctx);
  if (!slug) return { props: { store: null, products: [], departments: [], total: 0, page: 1, pages: 1, filters: {} } };
  const { query } = ctx;
  const { department, search, sort, page } = query;

  try {
    const params = { limit: 48 };
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
        total: productsResp.total || 0,
        page: productsResp.page || 1,
        pages: productsResp.pages || 1,
        filters: { department: department || null, search: search || null, sort: sort || null },
      },
    };
  } catch {
    return {
      props: { store: null, products: [], departments: [], total: 0, page: 1, pages: 1, filters: {} },
    };
  }
}
