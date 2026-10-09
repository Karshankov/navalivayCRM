-- Добавление группы Vaporesso
INSERT OR REPLACE INTO category_groups (id, categoryId, slug, name, cover_image, [order], hide_empty, parent_group_id)
VALUES ('g_pods_vaporesso', 'c_pods', 'vaporesso-line', 'VAPORESSO', '/uploads/groups/vaporesso.jpg', 15, 0, NULL);

-- Товар 1: Vaporesso XROS 3 Mini
INSERT OR REPLACE INTO products (id, categoryId, groupId, title, priceRub, description, variant, strength, cost_price, stock, min_stock, use_category_image, has_variants, createdAt)
VALUES ('p_pod_vaporesso_xros_3_mini', 'c_pods', 'g_pods_vaporesso', 'Vaporesso XROS 3 Mini', 0, 'Компактная POD-система с батареей 1000 мАч, картриджами на 2 мл и регулировкой мощности. Идеально подходит для солевых жидкостей.', NULL, NULL, 1100, 0, 8, 0, 1, datetime('now'));

-- Варианты XROS 3 Mini
INSERT OR REPLACE INTO product_variants (id, product_id, name, color_code, price_rub, stock, position)
VALUES 
('p_pod_vaporesso_xros_3_mini_variant_0', 'p_pod_vaporesso_xros_3_mini', 'Черный', '#1a1a1a', 1990, 20, 0),
('p_pod_vaporesso_xros_3_mini_variant_1', 'p_pod_vaporesso_xros_3_mini', 'Серебристый', '#c0c0c0', 1990, 15, 1),
('p_pod_vaporesso_xros_3_mini_variant_2', 'p_pod_vaporesso_xros_3_mini', 'Синий', '#2563eb', 2090, 18, 2),
('p_pod_vaporesso_xros_3_mini_variant_3', 'p_pod_vaporesso_xros_3_mini', 'Розовое золото', '#e0a896', 2190, 10, 3),
('p_pod_vaporesso_xros_3_mini_variant_4', 'p_pod_vaporesso_xros_3_mini', 'Зеленый', '#16a34a', 2090, 12, 4);

-- Изображения вариантов XROS 3 Mini
INSERT OR REPLACE INTO product_variant_images (variant_id, url, position)
VALUES 
('p_pod_vaporesso_xros_3_mini_variant_0', 'https://placehold.co/400x533/1a1a1a/ffffff?text=XROS+3+Mini+Black', 0),
('p_pod_vaporesso_xros_3_mini_variant_0', 'https://placehold.co/400x533/1a1a1a/ffffff?text=Black+Detail', 1),
('p_pod_vaporesso_xros_3_mini_variant_1', 'https://placehold.co/400x533/c0c0c0/000000?text=XROS+3+Mini+Silver', 0),
('p_pod_vaporesso_xros_3_mini_variant_2', 'https://placehold.co/400x533/2563eb/ffffff?text=XROS+3+Mini+Blue', 0),
('p_pod_vaporesso_xros_3_mini_variant_3', 'https://placehold.co/400x533/e0a896/000000?text=XROS+3+Mini+RoseGold', 0),
('p_pod_vaporesso_xros_3_mini_variant_4', 'https://placehold.co/400x533/16a34a/ffffff?text=XROS+3+Mini+Green', 0);

-- Ссылки XROS 3 Mini
INSERT OR REPLACE INTO product_links (productId, label, url, position)
VALUES ('p_pod_vaporesso_xros_3_mini', 'Официальный сайт', 'https://vaporesso.com/xros-3-mini', 0);

-- Товар 2: Vaporesso XROS 4
INSERT OR REPLACE INTO products (id, categoryId, groupId, title, priceRub, description, variant, strength, cost_price, stock, min_stock, use_category_image, has_variants, createdAt)
VALUES ('p_pod_vaporesso_xros_4', 'c_pods', 'g_pods_vaporesso', 'Vaporesso XROS 4', 0, 'Новейшая POD-система с батареей 1000 мАч, улучшенными картриджами на 3 мл, OLED-дисплеем и функцией блокировки от детей. Премиальные материалы.', NULL, NULL, 1400, 0, 10, 0, 1, datetime('now'));

-- Варианты XROS 4
INSERT OR REPLACE INTO product_variants (id, product_id, name, color_code, price_rub, stock, position)
VALUES 
('p_pod_vaporesso_xros_4_variant_0', 'p_pod_vaporesso_xros_4', 'Матовый черный', '#000000', 2290, 25, 0),
('p_pod_vaporesso_xros_4_variant_1', 'p_pod_vaporesso_xros_4', 'Серый градиент', '#6b7280', 2390, 18, 1),
('p_pod_vaporesso_xros_4_variant_2', 'p_pod_vaporesso_xros_4', 'Синий металлик', '#1e40af', 2490, 22, 2),
('p_pod_vaporesso_xros_4_variant_3', 'p_pod_vaporesso_xros_4', 'Красный', '#dc2626', 2490, 14, 3),
('p_pod_vaporesso_xros_4_variant_4', 'p_pod_vaporesso_xros_4', 'Золотой', '#f59e0b', 2590, 8, 4),
('p_pod_vaporesso_xros_4_variant_5', 'p_pod_vaporesso_xros_4', 'Фиолетовый градиент', '#9333ea', 2590, 10, 5);

-- Изображения вариантов XROS 4
INSERT OR REPLACE INTO product_variant_images (variant_id, url, position)
VALUES 
('p_pod_vaporesso_xros_4_variant_0', 'https://placehold.co/400x533/000000/ffffff?text=XROS+4+Black', 0),
('p_pod_vaporesso_xros_4_variant_0', 'https://placehold.co/400x533/000000/ffffff?text=XROS+4+Detail', 1),
('p_pod_vaporesso_xros_4_variant_1', 'https://placehold.co/400x533/6b7280/ffffff?text=XROS+4+Grey', 0),
('p_pod_vaporesso_xros_4_variant_2', 'https://placehold.co/400x533/1e40af/ffffff?text=XROS+4+Blue', 0),
('p_pod_vaporesso_xros_4_variant_3', 'https://placehold.co/400x533/dc2626/ffffff?text=XROS+4+Red', 0),
('p_pod_vaporesso_xros_4_variant_4', 'https://placehold.co/400x533/f59e0b/000000?text=XROS+4+Gold', 0),
('p_pod_vaporesso_xros_4_variant_5', 'https://placehold.co/400x533/9333ea/ffffff?text=XROS+4+Purple', 0);

-- Ссылки XROS 4
INSERT OR REPLACE INTO product_links (productId, label, url, position)
VALUES ('p_pod_vaporesso_xros_4', 'Официальный сайт', 'https://vaporesso.com/xros-4', 0);
