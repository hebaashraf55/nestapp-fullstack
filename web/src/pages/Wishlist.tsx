import { Link } from 'react-router-dom';
import { ProductCard, ProductSkeletons } from '../components/ProductCard';
import { useAuth } from '../auth/AuthContext';
import { useShopper } from '../shopper/ShopperContext';
import { useProductsById } from '../shopper/useProducts';

export function Wishlist() {
  const { user } = useAuth();
  const { wishlist } = useShopper();
  const { loading, items } = useProductsById(wishlist);
  return (
    <div className="page">
      <header className="page__head">
        <p className="eyebrow">Saved for later</p>
        <h1 className="h1--small">Wishlist</h1>
        <p className="lede lede--small">
          {user?.role === 'CUSTOMER'
            ? 'Saved to your account, on every device you sign in on.'
            : 'Saved in this browser. Sign in to keep it on your account.'}
        </p>
      </header>
      {loading && <ProductSkeletons count={Math.min(wishlist.length, 8)} />}
      {!loading && items.length === 0 && (
        <p className="notice">
          Nothing saved yet. Tap the heart on any piece to keep it here. <Link to="/shop">Browse the shop</Link>
        </p>
      )}
      {!loading && items.length > 0 && (
        <div className="products products--four">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
