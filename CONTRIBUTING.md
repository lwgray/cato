# Contributing to Cato

Welcome to Cato! We're excited you're interested in contributing. This guide will help you get started, whether you're fixing a typo or building a major visualization feature.

## Branching Strategy

- **`main`**: Production-ready code. Protected — no direct pushes allowed.
- **`develop`**: Primary development branch. All PRs should target this branch.
- **Feature branches**: Work in your fork's feature branches, created from `develop`.

**Quick workflow:**
1. Fork the Cato repository
2. Clone your fork and add the upstream remote
3. Always branch from `develop`
4. Submit PRs targeting `develop`

## Ways to Contribute

Cato needs more than code:

- **Bug reports**: Found something broken? Open an issue with steps to reproduce.
- **Documentation**: Improve setup guides, add examples, clarify behavior.
- **Testing**: Write tests, improve coverage, report edge cases.
- **Visualization ideas**: Propose new views or improvements to existing ones.
- **Code**: Bug fixes, features, performance improvements.

## Development Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- [Marcus](https://github.com/lwgray/marcus) running (for live data)
- Git

### Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/cato.git
cd cato
git remote add upstream https://github.com/lwgray/cato.git
git checkout develop

# 2. Python backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt

# 3. Node.js frontend
cd dashboard
npm install
cd ..

# 4. Install pre-commit hooks
pre-commit install

# 5. Run tests to verify
pytest tests/
```

### Development Workflow

```bash
# 1. Keep develop in sync
git checkout develop
git pull upstream develop
git push origin develop

# 2. Create a feature branch
git checkout -b feature/your-feature-name

# 3. Make changes and verify
pytest tests/                    # Run tests
mypy cato_src/ backend/          # Type checking
pre-commit run --all-files       # All quality checks

# 4. Commit with conventional commits
git add .
git commit -m "feat(network): highlight bottleneck nodes on hover"

# 5. Stay up to date
git fetch upstream
git rebase upstream/develop

# 6. Push and open PR targeting develop
git push origin feature/your-feature-name
```

## Code Quality

We use pre-commit hooks that run automatically before every commit:

- **MyPy**: Static type checking
- **Black**: Code formatting
- **isort**: Import ordering
- **Flake8**: Linting
- **Bandit**: Security checks
- **detect-secrets**: Prevents committing credentials
- **pydocstyle**: Docstring validation

### Running Checks Manually

```bash
pre-commit run --all-files   # All hooks
mypy cato_src/ backend/      # Type checking only
pytest --cov=cato_src --cov=backend --cov-report=html  # Tests with coverage
```

### Quality Standards

All code must pass:

1. **Type safety**: MyPy with no errors
2. **Formatting**: Black applied
3. **Import order**: isort organized
4. **Linting**: Flake8 clean
5. **Security**: No secrets in code
6. **Tests**: 80% minimum coverage for new code

## Coding Standards

```python
# Good: typed, documented
def get_agent_workload(agent_id: str, since: datetime) -> AgentWorkload:
    """
    Calculate workload metrics for a single agent.

    Parameters
    ----------
    agent_id : str
        Unique identifier of the agent
    since : datetime
        Start of the measurement window (must be timezone-aware)

    Returns
    -------
    AgentWorkload
        Aggregated task counts, durations, and parallel overlap
    """
    ...

# Bad: untyped, undocumented
def get_workload(a, t):
    ...
```

- Always use type hints
- NumPy-style docstrings on all public functions and classes
- Use structured logging, not `print`
- Update `CHANGELOG.md` for any user-facing change

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

```bash
# Good
git commit -m "feat(swimlane): add logarithmic time scale toggle"
git commit -m "fix(network): correct zombie task highlight color"
git commit -m "docs(installation): add Docker Compose quickstart"

# Bad
git commit -m "fixed stuff"
git commit -m "WIP"
```

## Testing

```
tests/
├── unit/        # Fast, isolated — mock external dependencies
└── integration/ # Requires backend running
```

```bash
pytest                          # All tests
pytest tests/unit/              # Fast tests only
pytest --cov=cato_src --cov=backend  # With coverage
pytest -k "test_network"        # Filter by name
```

Write tests for every new feature. Aim for 80% coverage on changed code.

## Pull Request Process

### Before Submitting

- [ ] `pre-commit run --all-files` passes
- [ ] `pytest` passes
- [ ] `mypy` passes
- [ ] `CHANGELOG.md` updated (if user-facing change)
- [ ] PR targets the `develop` branch

### PR Description Template

```markdown
## What
Brief description of the change.

## Why
The problem this solves or feature it adds.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor

## Testing
How you verified this works.
```

### After Merge

```bash
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
git checkout develop
git pull upstream develop
git push origin develop
```

## Getting Help

- **[GitHub Issues](https://github.com/lwgray/cato/issues)**: Bug reports and feature requests
- **[GitHub Discussions](https://github.com/lwgray/cato/discussions)**: Questions and ideas
- **[Marcus Repo](https://github.com/lwgray/marcus)**: For questions about the underlying coordination system

## Recognition

Contributors are listed in `CONTRIBUTORS.md` and credited in release notes for significant contributions.

---

Thank you for helping make Cato better!
