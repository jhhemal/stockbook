import { Modal } from '../ui';

export default function OrderModal({ onClose }) {
  return (
    <Modal title="Order" onClose={onClose}>
      <p style={{ color: 'var(--ink-2)', fontSize: 14 }}>Order form coming in the next task.</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
