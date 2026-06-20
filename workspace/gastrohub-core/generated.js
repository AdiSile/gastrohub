) AS cnt FROM supplier_orders';
    const conditions = [];
    const params = [];

    if (filters.supplierId) {
      conditions.push('supplierId = ?');
      params.push(filters.supplierId);
    }

    if (filters.tenantId) {
      conditions.push('tenantId = ?');
      params.push(filters.tenantId);
    }

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const row = dbGet(db, sql, params);

    return row ? row.cnt : 0;
  } catch (err) {
    throw new AppError(
      'Eroare la numărarea comenzilor: ' + err.message,
      500,
      'DB_QUERY_ERROR'
    );
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Constante
  VALID_STATUSES,
  VALID_PAYMENT_TERMS,
  VALID_ORDER_STATUSES,

  // Funcții de validare
  isValidString,
  isValidStatus,
  isValidPaymentTerm,
  isValidEmail,
  isValidRating,
  validateProducts,
  isValidOrderStatus,

  // Instanțe DB (backward compat – returnează getDb())
  getSuppliersDb: function () { return getDb(); },
  getSupplierOrdersDb: function () { return getDb(); },

  // CRUD Suppliers
  createSupplier,
  findSupplierById,
  findSuppliersByTenant,
  findSuppliersByStatus,
  findSuppliersByProduct,
  findSuppliersByMinRating,
  findSuppliersByPaymentTerms,
  updateSupplier,
  updateSupplierRating,
  updateSupplierStatus,
  addSupplierProduct,
  removeSupplierProduct,
  deleteSupplier,
  countSuppliersByTenant,
  countSuppliersByStatus,
  searchSuppliersByName,

  // CRUD Supplier Orders
  createSupplierOrder,
  placeSupplierOrder,
  findSupplierOrderById,
  findOrdersBySupplier,
  findOrdersByTenant,
  findSupplierOrders,
  updateSupplierOrder,
  updateOrderStatus,
  deleteSupplierOrder,
  countOrdersBySupplier,
  countSupplierOrders,
};