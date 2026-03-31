import { motion } from 'motion/react';

export function Twin({ tilt, small = false }: { tilt: number; small?: boolean }) {
  return (
    <motion.div
      animate={{ rotate: tilt, scale: small ? 0.88 : 1 }}
      transition={{ type: 'spring', stiffness: 160, damping: 18 }}
      className={`digital-twin ${small ? 'digital-twin-small' : ''}`}
    >
      <img src="/urlab_logo_icon_official.svg" alt="URLAB Twin" className="twin-mark" />
      <div className="twin-body" />
      <div className="twin-feet">
        <span />
        <span />
        <span />
        <span />
      </div>
    </motion.div>
  );
}
