#!/usr/bin/env python3
"""
Скрипт для подготовки архива для деплоя на Ubuntu сервер
Включает все необходимые файлы, включая картинки и загруженные файлы
"""

import os
import zipfile
import tarfile
import shutil
from datetime import datetime
from pathlib import Path
import json


class DeployArchiver:
    def __init__(self, project_root=None):
        """
        Инициализация архиватора
        
        Args:
            project_root: корневая директория проекта (по умолчанию - текущая)
        """
        self.project_root = Path(project_root) if project_root else Path.cwd()
        self.timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Директории и файлы для включения в архив
        self.include_dirs = [
            'server',
            'frontend',
            'scripts',
            'ops',
            'uploads',
        ]
        
        self.include_files = [
            'package.json',
            'package-lock.json',
            '.gitignore',
        ]
        
        # Паттерны для исключения
        self.exclude_patterns = [
            '__pycache__',
            '*.pyc',
            '*.pyo',
            '*.pyd',
            '.Python',
            'node_modules',
            '.git',
            '.gitignore.bak',
            '.env.local',
            '.env.development.local',
            '.env.test.local',
            '.DS_Store',
            'Thumbs.db',
            '*.swp',
            '*.swo',
            '*~',
            '.vscode',
            '.idea',
            'coverage',
            '.pytest_cache',
            '*.log',
            'dist',
            'build',
            '.coverage',
        ]
        
    def should_exclude(self, path):
        """
        Проверяет, должен ли файл/директория быть исключен
        
        Args:
            path: путь для проверки
            
        Returns:
            True если файл должен быть исключен
        """
        path_str = str(path)
        path_name = os.path.basename(path_str)
        
        for pattern in self.exclude_patterns:
            if pattern.startswith('*'):
                # Паттерн расширения файла
                if path_name.endswith(pattern[1:]):
                    return True
            elif pattern.endswith('*'):
                # Паттерн начала имени
                if path_name.startswith(pattern[:-1]):
                    return True
            else:
                # Точное совпадение
                if pattern in path_str or path_name == pattern:
                    return True
        
        return False
    
    def get_files_to_archive(self):
        """
        Получает список всех файлов для архивации
        
        Returns:
            Список путей файлов относительно корня проекта
        """
        files_to_archive = []
        
        # Добавляем корневые файлы
        for file_name in self.include_files:
            file_path = self.project_root / file_name
            if file_path.exists():
                files_to_archive.append(file_path.relative_to(self.project_root))
        
        # Добавляем директории с их содержимым
        for dir_name in self.include_dirs:
            dir_path = self.project_root / dir_name
            if not dir_path.exists():
                print(f"⚠️  Предупреждение: директория {dir_name} не найдена")
                continue
                
            for root, dirs, files in os.walk(dir_path):
                root_path = Path(root)
                
                # Фильтруем директории для обхода
                dirs[:] = [d for d in dirs if not self.should_exclude(root_path / d)]
                
                for file_name in files:
                    file_path = root_path / file_name
                    if not self.should_exclude(file_path):
                        files_to_archive.append(file_path.relative_to(self.project_root))
        
        return sorted(files_to_archive)
    
    def create_zip_archive(self, output_name=None):
        """
        Создает ZIP архив
        
        Args:
            output_name: имя выходного файла (без расширения)
            
        Returns:
            Путь к созданному архиву
        """
        if output_name is None:
            output_name = f'deploy_{self.timestamp}'
        
        archive_path = self.project_root / f'{output_name}.zip'
        files = self.get_files_to_archive()
        
        print(f"📦 Создание ZIP архива: {archive_path.name}")
        print(f"📁 Файлов для архивации: {len(files)}")
        
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in files:
                full_path = self.project_root / file_path
                zipf.write(full_path, file_path)
                print(f"  ✓ {file_path}")
        
        file_size = archive_path.stat().st_size / (1024 * 1024)  # MB
        print(f"\n✅ Архив создан: {archive_path}")
        print(f"📊 Размер: {file_size:.2f} MB")
        
        return archive_path
    
    def create_tar_gz_archive(self, output_name=None):
        """
        Создает TAR.GZ архив (более подходит для Linux)
        
        Args:
            output_name: имя выходного файла (без расширения)
            
        Returns:
            Путь к созданному архиву
        """
        if output_name is None:
            output_name = f'deploy_{self.timestamp}'
        
        archive_path = self.project_root / f'{output_name}.tar.gz'
        files = self.get_files_to_archive()
        
        print(f"📦 Создание TAR.GZ архива: {archive_path.name}")
        print(f"📁 Файлов для архивации: {len(files)}")
        
        with tarfile.open(archive_path, 'w:gz') as tarf:
            for file_path in files:
                full_path = self.project_root / file_path
                tarf.add(full_path, arcname=file_path)
                print(f"  ✓ {file_path}")
        
        file_size = archive_path.stat().st_size / (1024 * 1024)  # MB
        print(f"\n✅ Архив создан: {archive_path}")
        print(f"📊 Размер: {file_size:.2f} MB")
        
        return archive_path
    
    def create_manifest(self):
        """
        Создает манифест с информацией о деплое
        
        Returns:
            Путь к файлу манифеста
        """
        manifest_path = self.project_root / f'deploy_manifest_{self.timestamp}.json'
        files = self.get_files_to_archive()
        
        manifest = {
            'timestamp': self.timestamp,
            'datetime': datetime.now().isoformat(),
            'project_root': str(self.project_root),
            'total_files': len(files),
            'included_directories': self.include_dirs,
            'included_files': self.include_files,
            'excluded_patterns': self.exclude_patterns,
            'files': [str(f) for f in files]
        }
        
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        
        print(f"📝 Манифест создан: {manifest_path}")
        return manifest_path
    
    def print_summary(self):
        """
        Выводит сводку о файлах для архивации
        """
        files = self.get_files_to_archive()
        
        # Группируем по директориям
        by_dir = {}
        for file_path in files:
            dir_name = str(file_path.parts[0]) if len(file_path.parts) > 1 else 'root'
            by_dir.setdefault(dir_name, []).append(file_path)
        
        print("\n" + "="*60)
        print("📊 СВОДКА ПО ФАЙЛАМ")
        print("="*60)
        
        for dir_name, dir_files in sorted(by_dir.items()):
            print(f"\n📁 {dir_name}: {len(dir_files)} файл(ов)")
            
            # Подсчет по расширениям
            extensions = {}
            for f in dir_files:
                ext = f.suffix or 'no extension'
                extensions[ext] = extensions.get(ext, 0) + 1
            
            for ext, count in sorted(extensions.items()):
                print(f"   - {ext}: {count}")
        
        print(f"\n{'='*60}")
        print(f"📦 ВСЕГО ФАЙЛОВ: {len(files)}")
        print(f"{'='*60}\n")


def main():
    """
    Главная функция для запуска из командной строки
    """
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Подготовка архива для деплоя на Ubuntu сервер'
    )
    parser.add_argument(
        '--format',
        choices=['zip', 'tar.gz', 'both'],
        default='tar.gz',
        help='Формат архива (по умолчанию: tar.gz)'
    )
    parser.add_argument(
        '--name',
        type=str,
        help='Имя архива (без расширения, по умолчанию: deploy_TIMESTAMP)'
    )
    parser.add_argument(
        '--manifest',
        action='store_true',
        help='Создать JSON манифест с информацией о деплое'
    )
    parser.add_argument(
        '--summary',
        action='store_true',
        help='Показать сводку файлов без создания архива'
    )
    parser.add_argument(
        '--project-root',
        type=str,
        help='Корневая директория проекта (по умолчанию: текущая)'
    )
    
    args = parser.parse_args()
    
    # Создаем архиватор
    archiver = DeployArchiver(project_root=args.project_root)
    
    # Если нужна только сводка
    if args.summary:
        archiver.print_summary()
        return
    
    print("\n🚀 ПОДГОТОВКА АРХИВА ДЛЯ ДЕПЛОЯ\n")
    
    # Создаем архивы
    if args.format in ['zip', 'both']:
        archiver.create_zip_archive(args.name)
        print()
    
    if args.format in ['tar.gz', 'both']:
        archiver.create_tar_gz_archive(args.name)
        print()
    
    # Создаем манифест если нужно
    if args.manifest:
        archiver.create_manifest()
        print()
    
    print("🎉 Готово!\n")


if __name__ == '__main__':
    main()
