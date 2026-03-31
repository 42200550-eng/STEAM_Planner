import { motion } from 'motion/react';
export function AwakeningScreen() {
  return (
    <div className="awakening-screen">
      <div className="obsidian-haze" />
      <motion.img
        src="/urlab_logo_icon_official.svg"
        alt="URLAB Lambda"
        className="splash-lambda"
        initial={{ opacity: 0, scale: 0.9, filter: 'brightness(0.75) invert(1)' }}
        animate={{ opacity: [0, 1, 1], scale: [0.9, 1, 1], filter: ['brightness(0.75) invert(1)', 'brightness(1.18) invert(1)', 'brightness(1.08) invert(1)'] }}
        transition={{ duration: 2.1, ease: 'easeInOut', times: [0, 0.68, 1] }}
      />
    </div>
  );
}
