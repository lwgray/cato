# Cato Dashboard - Quick Reference

## Commands

```bash
./cato start      # Start dashboard
./cato stop       # Stop dashboard  
./cato restart    # Restart dashboard
./cato status     # Check what's running
./cato logs       # View all logs
./cato help       # Show all commands
```

## URLs

- **Dashboard**: http://localhost:5173
- **Backend API**: http://localhost:4301
- **API Docs**: http://localhost:4301/docs

## Configuration

Edit `config.json` to change ports:
```json
{
  "backend": { "port": 4301 },
  "frontend": { "port": 5173 }
}
```

## Logs

```bash
tail -f /tmp/cato-backend.log   # Backend
tail -f /tmp/cato-frontend.log  # Frontend
```

## Troubleshooting

**Can't connect to backend?**
```bash
./cato restart
```

**Port already in use?**
```bash
./cato stop
lsof -i :4301  # Check what's using the port
./cato start
```

**See full documentation**: `DASHBOARD.md`
