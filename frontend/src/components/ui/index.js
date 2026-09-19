// frontend/src/components/ui/index.js
// Shared module-page kit. Every module page is built from these, so the layout
// language, validation alerts, confirmations, loading and empty states are
// identical everywhere.

export { default as PageHeader } from './PageHeader';
export { default as StatCards } from './StatCards';
export { default as ModuleTable } from './ModuleTable';
export { default as FormDialog } from './FormDialog';
export { default as EmptyState } from './EmptyState';
export { useChartTheme } from './chartTheme';
export { default as useBranding, refreshBranding, DEFAULT_BRANDING } from './useBranding';
export { printReceipt, receiptNo, describePayment } from './receipt';
export { printInvoice } from './invoice';
export { default as PoweredBy } from './PoweredBy';
export { default as useExceptions } from './useExceptions';
export { default as usePlans, BUILTIN_PLAN_NAMES } from './usePlans';
export { useToast, ToastProvider } from './Toast';
export { useConfirm, ConfirmProvider } from './ConfirmDialog';
export * from './format';
