import os
import datetime

class FileMerger:
    def __init__(self):
        # File extensions to include in the merge
        self.supported_extensions = {
            # Web Development
            '.html', '.htm', '.xhtml', '.css', '.less', '.sass', '.scss',
            '.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs', '.vue', '.svelte',
            '.webmanifest', '.htaccess',

            # Python
            '.py', '.pyi', '.pyx', '.pxd', '.pxi', '.pyc', '.pyd', '.pyw',
            '.ipynb', '.rpy', '.pyz', '.whl',

            # Java & JVM
            '.java', '.class', '.jar', '.war', '.jsp', '.jspx', '.gradle',
            '.groovy', '.gvy', '.gy', '.gsh', '.kt', '.kts', '.ktm', '.scala',
            '.sc', '.clj', '.cljs', '.cljc', '.edn',

            # C/C++
            '.c', '.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp', '.hh', '.hxx',
            '.h++', '.inl', '.inc', '.ixx', '.def', '.tcc',

            # C#/.NET
            '.cs', '.csx', '.vb', '.fs', '.fsx', '.fsi', '.fsscript',
            '.xaml', '.razor', '.cshtml', '.vbhtml', '.aspx', '.ascx',

            # PHP
            '.php', '.php3', '.php4', '.php5', '.phtml', '.phps',
            '.phar', '.inc',

            # Ruby
            '.rb', '.rbw', '.rake', '.gemspec', '.ru', '.erb', '.rhtml',
            '.rjs', '.rxml', '.builder',

            # Go
            '.go', '.mod', '.sum', '.work',

            # Rust
            '.rs', '.rlib', '.rst',

            # Swift & Objective-C
            '.swift', '.m', '.mm', '.h', '.metal',

            # Shell & Scripts
            '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.tcsh',
            '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.vbs', '.vbe',
            '.wsf', '.wsc',

            # Database & Query
            '.sql', '.mysql', '.pgsql', '.plsql', '.ora', '.spl',
            '.hql', '.qml', '.prisma',

            # Configuration
            '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini',
            '.conf', '.config', '.cfg', '.properties', '.prop', '.env',
            '.editorconfig', '.babelrc', '.eslintrc', '.prettierrc',
            '.dockerignore', '.gitignore', '.npmrc', '.yarnrc',
            '.gitattributes',

            # Documentation
            '.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdtxt',
            '.mdtext', '.txt', '.text', '.rst', '.asciidoc', '.adoc', '.asc',
            '.creole', '.wiki', '.mediawiki', '.tex', '.ltx', '.latex',

            # Data Formats
            '.xml', '.xsl', '.xslt', '.svg', '.wsdl', '.dtd', '.xsd',
            '.rss', '.atom', '.csv', '.tsv', '.ods', '.ots',

            # Mobile Development
            '.dart', '.kt', '.gradle', '.plist', '.storyboard', '.xib',
            '.pbxproj', '.xcworkspacedata', '.xcscheme',

            # Other Languages
            '.lua', '.tcl', '.tk', '.r', '.rmd', '.julia', '.jl',
            '.f', '.f90', '.f95', '.f03', '.f08', '.for', '.f77',
            '.hs', '.lhs', '.elm', '.erl', '.hrl', '.ex', '.exs',
            '.eex', '.leex', '.heex', '.ml', '.mli', '.pp',
            '.pas', '.inc', '.dpr', '.dpk',

            # Build & Package
            '.cmake', '.make', '.mk', '.mak', '.dockerfile', '.lock',
            '.gemfile', '.rakefile', '.nuspec', '.nupkg', '.csproj',
            '.vbproj', '.fsproj', '.vcxproj', '.sln',

            # Template Files
            '.tmpl', '.tpl', '.template', '.mustache', '.handlebars', '.hbs',
            '.ejs', '.eta', '.jade', '.pug', '.haml', '.slim', '.liquid',
            '.j2', '.jinja', '.jinja2',
        }
        # Files to exclude from merge
        self.exclude_files = {
            'file_merger.py',  # exclude the script itself
        }
        # Pattern for output files to exclude
        self.output_pattern = '_merged_'
    
    def get_directory_structure(self, startpath):
        """Generate a formatted string of the directory structure."""
        structure = []
        for root, dirs, files in os.walk(startpath):
            level = root.replace(startpath, '').count(os.sep)
            indent = '  ' * level
            structure.append(f'{indent}{os.path.basename(root)}/')
            subindent = '  ' * (level + 1)
            for f in files:
                structure.append(f'{subindent}{f}')
        return '\n'.join(structure)

    def is_text_file(self, file_path):
        """Check if the file is a text file based on extension and not in exclude list."""
        filename = os.path.basename(file_path)
        
        # Skip the script itself and generated output files
        if (filename in self.exclude_files or 
            filename.startswith(self.output_pattern)):
            return False
            
        _, ext = os.path.splitext(file_path.lower())
        return ext in self.supported_extensions

    def merge_files(self, source_dir, output_file):
        """Merge all supported files from the directory and its subdirectories."""
        try:
            with open(output_file, 'w', encoding='utf-8') as outfile:
                # Write timestamp
                timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                outfile.write(f"Generated on: {timestamp}\n\n")
                
                # Write directory structure
                outfile.write("Directory Structure:\n")
                outfile.write("===================\n")
                outfile.write(self.get_directory_structure(source_dir))
                outfile.write("\n\n")
                outfile.write("File Contents:\n")
                outfile.write("=============\n\n")

                # Process all files
                for root, _, files in os.walk(source_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        if self.is_text_file(file_path):
                            try:
                                with open(file_path, 'r', encoding='utf-8') as infile:
                                    relative_path = os.path.relpath(file_path, source_dir)
                                    outfile.write(f"{'=' * 80}\n")
                                    outfile.write(f"File: {relative_path}\n")
                                    outfile.write(f"{'=' * 80}\n\n")
                                    outfile.write(infile.read())
                                    outfile.write("\n\n")
                            except Exception as e:
                                outfile.write(f"Error reading file {file_path}: {str(e)}\n\n")

                return True, "Files merged successfully!"
        except Exception as e:
            return False, f"Error during merge: {str(e)}"

def main():
    merger = FileMerger()
    
    # Get the current directory
    current_dir = os.getcwd()
    
    # Get directory name for the output file
    dir_name = os.path.basename(current_dir)
    
    # Create output filename with directory name and timestamp
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = f"{dir_name}_merged_{timestamp}.txt"
    
    print(f"Merging files from: {current_dir}")
    print(f"Output file will be: {output_file}")
    
    success, message = merger.merge_files(current_dir, output_file)
    print(message)

if __name__ == "__main__":
    main()
