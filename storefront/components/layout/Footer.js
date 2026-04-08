import { useStore } from '../../lib/store';

export default function Footer() {
  const store = useStore();

  return (
    <footer className="sf-footer">
      <div className="sf-container">
        <p>&copy; {new Date().getFullYear()} {store?.storeName || 'Store'}. All rights reserved.</p>
        <p style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>Powered by Storv</p>
      </div>
    </footer>
  );
}
