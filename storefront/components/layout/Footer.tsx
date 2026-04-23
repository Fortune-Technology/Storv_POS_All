import { useStore } from '../../lib/store';

export default function Footer() {
  const store = useStore();

  return (
    <footer className="sf-footer">
      <div className="sf-container">
        <p>&copy; {new Date().getFullYear()} {store?.storeName || store?.name || 'Store'}. All rights reserved.</p>
        <p className="sf-footer-powered">Powered by Storeveu</p>
      </div>
    </footer>
  );
}
