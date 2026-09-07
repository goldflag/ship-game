import type { ComponentProps } from 'react';
import './controls.css';
export { Select, SelectOption } from './Select';

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'icon' }) {
  return <button {...props} type={type} className={`ui-button ${variant}-button ${className}`}/>;
}

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input {...props} className={`ui-input ${className}`}/>;
}
