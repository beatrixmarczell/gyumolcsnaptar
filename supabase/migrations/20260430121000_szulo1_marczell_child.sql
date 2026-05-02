-- szulo1.demo → Marczell Zsombor Dániel (pontosan mint a React névsor `src/App.tsx`).
-- Meglévő DB: a PK (group_id, user_id, child_name) miatt a child_name oszlop frissíthető.

update public.parent_child_links pcl
set child_name = 'Marczell Zsombor Dániel'
from public.user_profiles up
where pcl.user_id = up.id
  and up.email = 'szulo1@example.com'
  and pcl.group_id = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'
  and pcl.child_name = 'Balassa-Molcsán Hunor';
