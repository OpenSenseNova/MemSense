function parseRoleMap(raw) {
  try {
    const m = JSON.parse(raw || '{}');
    return typeof m === 'object' && m ? m : {};
  } catch {
    return {};
  }
}

const ROLE_LEVEL = { viewer: 1, operator: 2, admin: 3 };

export function createAuth() {
  const roleMap = parseRoleMap(process.env.MEMSENSE_DASHBOARD_TOKENS_JSON);
  const authDisabled = Object.keys(roleMap).length === 0;

  function getRole(req) {
    if (authDisabled) return 'admin';
    const token = req.headers['x-memsense-token'] || req.query.token;
    if (!token) return null;
    return roleMap[String(token)] || null;
  }

  function requireRole(minRole = 'viewer') {
    return (req, res, next) => {
      const role = getRole(req);
      if (!role) return res.status(401).json({ ok: false, error: 'unauthorized' });
      if ((ROLE_LEVEL[role] || 0) < (ROLE_LEVEL[minRole] || 0)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      req.memsenseRole = role;
      next();
    };
  }

  return { requireRole };
}
